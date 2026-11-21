package com.nimrod.mirrorkiosk

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * Makes the mirror look like an ESPHome device to Home Assistant, so HA's own ESPHome integration adds it as a Bluetooth proxy
 * and/or an Assist satellite (voice), over ONE connection on port 6053.
 *
 * The rules (Nov 19, 2026): switched in Home Assistant, one switch each, all OFF by default, nothing runs unless switched on.
 *   "esp_bt"    Bluetooth proxy: only while on (and HA subscribes) is Bluetooth turned on and a passive scan running.
 *   "esp_voice" voice: only while on can the mic open, for a turn (HA's start_conversation, /voice/test, or the wake word).
 *   "esp_wake"  wake word: only while on (with voice) is the mic open to listen for it, on the mirror (WakeWord.kt).
 * The 6053 server runs only while Bluetooth or voice is on. The switches are Glass Panes integration entities (switch.py), which
 * call /esphome/<bt|voice|wake>/<on|off> on the app's control port.
 *
 * Encryption (EspNoise): the mirror starts with no key and says so (api_encryption_provisionable). When HA's ESPHome integration
 * first connects, it makes a random key itself and hands it over on a zero-key Noise connection (HA core esphome/manager.py
 * `_async_provision_key_over_noise`), then keeps the key in its ESPHome entry. From then on only encrypted connections with that key
 * are accepted. Voice is offered only on such a connection (EspLogic.voiceFlags), so mic audio never crosses the network in clear.
 *
 * Privacy: addresses of nearby Bluetooth devices go only to the connected Home Assistant; mic audio goes only there and only during
 * a turn; the wake word is heard on the mirror and nothing of it leaves it. None of these are logged. A sign shows on screen whenever
 * the mic is open (ListenSign).
 */
object EspServer {
    const val PORT = 6053
    private const val MAX_TURN_MS = 15_000L               // longest a turn may listen
    private const val MAX_ANSWER_MS = 30_000L             // and then, once HA has the speech, how long it may take to answer
    private const val IDLE_TIMEOUT_MS = 90_000
    private const val PENDING_AUDIO_MAX = 32_000 * 2      // up to 2 s of audio said after the wake word, kept until HA is ready
    private const val ESPHOME_VERSION = "2025.9.0"

    @Volatile private var app: Context? = null
    @Volatile private var server: ServerSocket? = null
    @Volatile private var client: EspConnection? = null
    @Volatile var btOn = false; private set
    @Volatile var voiceOn = false; private set
    @Volatile var wakeOn = false; private set
    @Volatile private var key: ByteArray? = null

    // numbers for /esphome (counts only)
    private val connections = AtomicInteger(0)
    private val refused = AtomicInteger(0)
    private val wrongKey = AtomicInteger(0)
    private val plaintextRefused = AtomicInteger(0)
    private val advSent = AtomicInteger(0)
    private val turns = AtomicInteger(0)
    @Volatile private var lastTurn = ""
    @Volatile private var lastError = ""
    @Volatile private var keyReceivedAt = 0L

    private fun prefs() = Kiosk.prefs(app!!)

    fun switches() = EspLogic.Switches(btOn, voiceOn, wakeOn, key != null)

    /** Read the switches at app start and start what is on. */
    @Synchronized
    fun init(ctx: Context) {
        app = ctx.applicationContext
        val p = prefs()
        key = EspProto.unbase64(p.getString("esp_psk", "") ?: "")?.takeIf { it.size == 32 }
        apply(p.getBoolean("esp_bt", false), p.getBoolean("esp_voice", false), p.getBoolean("esp_wake", false))
    }

    /** Change the switches. A change of features drops the connection so Home Assistant reconnects and re-reads the device info. */
    @Synchronized
    fun set(ctx: Context, bt: Boolean? = null, voice: Boolean? = null, wake: Boolean? = null) {
        app = ctx.applicationContext
        val ed = prefs().edit()
        if (bt != null) ed.putBoolean("esp_bt", bt)
        if (voice != null) ed.putBoolean("esp_voice", voice)
        if (wake != null) ed.putBoolean("esp_wake", wake)
        ed.apply()
        apply(bt ?: btOn, voice ?: voiceOn, wake ?: wakeOn)
    }

    /**
     * Forget the encryption key (GET /esphome/key/forget). The mirror then accepts plaintext again and Home Assistant hands over a
     * key again on its next connection. For when the mirror's ESPHome entry was deleted and re-added from another Home Assistant.
     */
    @Synchronized
    fun forgetKey(ctx: Context) {
        app = ctx.applicationContext
        if (key == null) return
        key = null
        prefs().edit().remove("esp_psk").apply()
        Kiosk.log("esphome", "encryption key forgotten")
        client?.close()
        Nsd.update()
        Mic.update()
    }

    @Synchronized
    private fun apply(bt: Boolean, voice: Boolean, wake: Boolean) {
        val changed = bt != btOn || voice != voiceOn
        val wakeChanged = wake != wakeOn
        btOn = bt; voiceOn = voice; wakeOn = wake
        if (changed || wakeChanged) Kiosk.log("esphome", "bluetooth=$bt voice=$voice wake_word=$wake")
        // HA reconnects and reads the new feature flags (and, for the wake word, the new wake-word list for its select)
        if (changed || wakeChanged) client?.close()
        if (!bt) Ble.stop()
        if (!voice) Turn.stop("voice switched off")
        if (EspLogic.serverRuns(switches())) startServer() else stopServer()
        Mic.update()
    }

    // ---------------- identity ----------------

    private fun mac(): String {
        val p = prefs()
        var m = p.getString("esp_mac", "") ?: ""
        if (EspProto.macToLong(m) < 0) {
            val r = ByteArray(6); java.security.SecureRandom().nextBytes(r)
            m = EspProto.localMac(r)
            p.edit().putString("esp_mac", m).apply()
        }
        return m
    }

    fun deviceName(): String = EspProto.deviceName(mac())

    private fun deviceInfo(link: EspLogic.Link): EspProto.DeviceInfo {
        val m = mac()
        val s = switches()
        return EspProto.DeviceInfo(
            name = EspProto.deviceName(m), friendlyName = "Glass Panes mirror", mac = m, btMac = EspLogic.bluetoothMac(m),
            version = ESPHOME_VERSION, btFlags = EspLogic.bluetoothFlags(s, link), voiceFlags = EspLogic.voiceFlags(s, link),
            encryptionSupported = true, provisionable = !s.hasKey,
        )
    }

    // ---------------- server ----------------

    private fun startServer() {
        if (server != null) return
        val s = try { ServerSocket(PORT) } catch (e: Exception) { lastError = "port $PORT busy (" + e.javaClass.simpleName + ")"; return }
        server = s
        Kiosk.log("esphome", "listening on $PORT")
        Nsd.update()
        thread(name = "esphome-accept", isDaemon = true) {
            try {
                while (server === s) {
                    val sock = s.accept()
                    if (!allowed(sock.inetAddress)) { refused.incrementAndGet(); try { sock.close() } catch (e: Exception) { }; continue }
                    thread(name = "esphome-conn", isDaemon = true) { EspConnection(sock, host).run(IDLE_TIMEOUT_MS) }
                }
            } catch (e: Exception) { /* closed */ }
        }
    }

    private fun stopServer() {
        val s = server ?: return
        server = null
        try { s.close() } catch (e: Exception) { }
        client?.close()
        Ble.stop()
        Nsd.update()
        Kiosk.log("esphome", "stopped")
    }

    /**
     * Extra fence on top of encryption: when "esp_lock" is on (default), accept connections only from the Home Assistant host of
     * the paired page address. /esphome/lock/off switches it off if your HA reaches the mirror from a different address.
     */
    private fun allowed(from: InetAddress?): Boolean {
        if (from == null) return false
        if (from.isLoopbackAddress) return true
        if (!prefs().getBoolean("esp_lock", true)) return true
        val host = try { java.net.URI(prefs().getString("url", "") ?: "").host } catch (e: Exception) { null } ?: return true   // not paired: no host to compare
        return try { InetAddress.getAllByName(host).any { it == from } } catch (e: Exception) { false }
    }

    /** What each connection (EspConnection) asks of the mirror. */
    private val host = object : EspConnection.Host {
        override fun switches() = EspServer.switches()
        override fun key() = key
        override fun storeKey(key: ByteArray) {
            synchronized(EspServer) {
                EspServer.key = key
                prefs().edit().putString("esp_psk", EspProto.base64(key)).apply()
            }
            Nsd.update()
            EspConnection.reconnectPlain(client)
        }
        override fun deviceName() = EspServer.deviceName()
        override fun mac() = EspServer.mac()
        override fun deviceInfo(link: EspLogic.Link) = EspServer.deviceInfo(link)
        override fun opened(c: EspConnection) {
            val old = client
            client = c                                     // ESPHome allows one client; a new HA connection replaces the old one
            connections.incrementAndGet()
            if (old != null && old !== c) old.close()
        }
        override fun closed(c: EspConnection) {
            if (Turn.owner === c) Turn.stop("connection closed")
            if (Ble.owner === c) Ble.stop()
            if (client === c) { client = null; Mic.update() }
        }
        override fun note(event: String, detail: String) {
            when (event) {
                "plaintext_refused" -> plaintextRefused.incrementAndGet()
                "wrong_key" -> { wrongKey.incrementAndGet(); lastError = detail }
                "key_received" -> { keyReceivedAt = System.currentTimeMillis(); Kiosk.log("esphome", "encryption key received from Home Assistant") }
                else -> if (detail.isNotEmpty()) lastError = detail
            }
        }
        override fun message(c: EspConnection, f: EspProto.Frame) = handle(c, f)
    }

    /** Bluetooth, voice and wake-word messages from Home Assistant. */
    private fun handle(c: EspConnection, f: EspProto.Frame) {
        when (f.type) {
            EspProto.SUBSCRIBE_BLE_ADVERTISEMENTS -> if (btOn) Ble.start(c)
            EspProto.UNSUBSCRIBE_BLE_ADVERTISEMENTS -> if (Ble.owner === c) Ble.stop()
            EspProto.SUBSCRIBE_VOICE_ASSISTANT -> {
                c.voiceSubscribed = EspProto.parse(f.payload).bool(1) && EspLogic.voiceFlags(switches(), c.kind) != 0
                Mic.update()
            }
            EspProto.VOICE_ASSISTANT_RESPONSE -> {
                val r = EspProto.parse(f.payload)
                if (r.bool(2)) Turn.stop("Home Assistant refused the turn") else Turn.streamNow(c)
            }
            EspProto.VOICE_ASSISTANT_EVENT -> {
                val (type, data) = EspProto.parseEvent(f.payload)
                Turn.onEvent(c, type, data)
            }
            EspProto.VOICE_ASSISTANT_ANNOUNCE_REQUEST -> {
                val r = EspProto.parse(f.payload)
                val media = r.string(1)
                val startConversation = r.bool(4)
                thread(isDaemon = true) { Turn.announce(c, media, startConversation) }
            }
            EspProto.VOICE_ASSISTANT_CONFIG_REQUEST -> {
                val allowed = EspLogic.wakeAllowed(switches()) && EspLogic.voiceFlags(switches(), c.kind) != 0
                val available = if (allowed) WakeLogic.MODELS.map { EspProto.WakeWordInfo(it.id, it.phrase, it.languages) } else emptyList()
                val active = if (allowed) listOf(Mic.modelId()) else emptyList()
                c.send(EspProto.VOICE_ASSISTANT_CONFIG_RESPONSE, EspProto.configurationResponse(available, active, if (allowed) 1 else 0))
            }
            EspProto.VOICE_ASSISTANT_SET_CONFIG -> {
                val ids = EspProto.parseSetConfiguration(f.payload)
                ids.firstOrNull { id -> WakeLogic.MODELS.any { it.id == id } }?.let { Mic.setModel(it) }
            }
            else -> { /* SubscribeStates, logs, HA services/states, time, audio...: accepted and ignored */ }
        }
    }

    // ---------------- mDNS: how Home Assistant finds the mirror ("Discovered: ESPHome") ----------------

    private object Nsd {
        private var listener: NsdManager.RegistrationListener? = null
        @Volatile var registered = false

        @Synchronized
        fun update() {
            val ctx = app ?: return
            val nsd = ctx.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return
            listener?.let { try { nsd.unregisterService(it) } catch (e: Exception) { } }
            listener = null; registered = false
            if (server == null) return
            val info = NsdServiceInfo().apply {
                serviceName = deviceName()
                serviceType = "_esphomelib._tcp"
                port = PORT
                setAttribute("mac", EspProto.plainMac(mac()))
                setAttribute("friendly_name", "Glass Panes mirror")
                setAttribute("version", ESPHOME_VERSION)
                setAttribute("platform", "android")
                setAttribute("network", "wifi")
                if (key != null) setAttribute("api_encryption", EspNoise.PROTOCOL) else setAttribute("api_encryption_supported", EspNoise.PROTOCOL)
            }
            val l = object : NsdManager.RegistrationListener {
                override fun onServiceRegistered(i: NsdServiceInfo) { registered = true }
                override fun onRegistrationFailed(i: NsdServiceInfo, code: Int) { lastError = "mDNS registration failed (code $code)" }
                override fun onServiceUnregistered(i: NsdServiceInfo) { }
                override fun onUnregistrationFailed(i: NsdServiceInfo, code: Int) { }
            }
            try { nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, l); listener = l } catch (e: Exception) { lastError = "mDNS: " + e.javaClass.simpleName }
        }
    }

    // ---------------- Bluetooth proxy (passive scan, raw advertisements) ----------------

    private object Ble {
        @Volatile var owner: EspConnection? = null
        @Volatile var subscribed = false
        @Volatile var scanning = false
        private var weTurnedItOn = false
        private val batch = ArrayList<EspProto.Adv>()
        private var callback: ScanCallback? = null
        private var flusher: Thread? = null

        @Synchronized
        @Suppress("DEPRECATION")
        fun start(c: EspConnection) {
            owner = c; subscribed = true
            if (scanning) return
            val ctx = app ?: return
            if (ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                lastError = "no location permission (needed by Android for Bluetooth scans)"; return
            }
            thread(isDaemon = true, name = "esphome-ble-start") {
                try {
                    val adapter = BluetoothAdapter.getDefaultAdapter() ?: run { lastError = "no Bluetooth adapter"; return@thread }
                    if (adapter.state != BluetoothAdapter.STATE_ON) {
                        weTurnedItOn = true
                        adapter.enable()
                        val t0 = Kiosk.mono()
                        while (adapter.state != BluetoothAdapter.STATE_ON && Kiosk.mono() - t0 < BtLogic.TURN_ON_WAIT_S * 1000L) Thread.sleep(250)
                    }
                    val scanner = adapter.bluetoothLeScanner ?: run { lastError = "Bluetooth did not turn on"; return@thread }
                    val cb = object : ScanCallback() {
                        override fun onScanResult(callbackType: Int, result: ScanResult) {
                            val addr = EspProto.macToLong(result.device?.address)
                            if (addr < 0) return
                            val data = EspProto.trimAdvertisement(result.scanRecord?.bytes)
                            synchronized(batch) { if (batch.size < 256) batch.add(EspProto.Adv(addr, result.rssi, data)) }
                        }
                        override fun onScanFailed(errorCode: Int) { lastError = "Bluetooth scan failed (code $errorCode)"; scanning = false }
                    }
                    synchronized(this) {
                        if (!subscribed) return@thread
                        scanner.startScan(null, settings(), cb)
                        callback = cb; scanning = true
                        Kiosk.log("esphome", "bluetooth scan started")
                        flusher = thread(isDaemon = true, name = "esphome-ble-flush") { flushLoop(scanner, cb) }
                    }
                } catch (e: Exception) { lastError = "Bluetooth start failed (" + e.javaClass.simpleName + ")" }
            }
        }

        /** Passive scanning is all Android 6 offers to apps anyway (no scan requests are sent); LOW_LATENCY hears the most. */
        private fun settings() = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()

        /** Every 100 ms, send what was heard in batches of 16. Restart the scan every 25 minutes (Android weakens long scans after 30). */
        private fun flushLoop(scanner: android.bluetooth.le.BluetoothLeScanner, cb: ScanCallback) {
            var startedAt = Kiosk.mono()
            while (scanning && callback === cb) {
                try { Thread.sleep(100) } catch (e: InterruptedException) { return }
                val items: List<EspProto.Adv> = synchronized(batch) { val copy = ArrayList(batch); batch.clear(); copy }
                val c = owner
                if (c != null) for (chunk in items.chunked(EspProto.ADV_BATCH)) {
                    try { c.send(EspProto.BLE_RAW_ADVERTISEMENTS, EspProto.rawAdvertisements(chunk)); advSent.addAndGet(chunk.size) } catch (e: Exception) { break }
                }
                if (Kiosk.mono() - startedAt > 25 * 60 * 1000L) {
                    try { scanner.stopScan(cb); scanner.startScan(null, settings(), cb) } catch (e: Exception) { }
                    startedAt = Kiosk.mono()
                }
            }
        }

        @Synchronized
        @Suppress("DEPRECATION")
        fun stop() {
            subscribed = false; owner = null
            val cb = callback
            callback = null
            if (scanning || cb != null) {
                scanning = false
                try { if (cb != null) BluetoothAdapter.getDefaultAdapter()?.bluetoothLeScanner?.stopScan(cb) } catch (e: Exception) { }
                Kiosk.log("esphome", "bluetooth scan stopped")
            }
            synchronized(batch) { batch.clear() }
            flusher?.interrupt(); flusher = null
            if (weTurnedItOn) {           // leave Bluetooth as we found it
                weTurnedItOn = false
                try { BluetoothAdapter.getDefaultAdapter()?.disable() } catch (e: Exception) { }
            }
        }
    }

    // ---------------- the microphone (one owner: the wake word and voice turns share it) ----------------

    private object Mic {
        @Volatile private var worker: Thread? = null
        @Volatile var open = false; private set
        @Volatile private var wake: WakeWord? = null
        @Volatile private var model = WakeLogic.DEFAULT_MODEL
        @Volatile var listening = false; private set
        @Volatile private var lastWakes = 0
        @Volatile private var wakeError = ""

        fun modelId(): String = model

        fun setModel(id: String) {
            if (id == model) return
            model = id
            app?.let { Kiosk.prefs(it).edit().putString("esp_wake_model", id).apply() }
            Kiosk.log("voice", "wake word set to $id")
            dropModel()
            update()
        }

        @Synchronized private fun dropModel() { wake?.close(); wake = null }

        private fun permission(): Boolean = app?.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

        /** Should the wake word be listened for now? */
        fun wantsWake(): Boolean = EspLogic.micListens(switches(), client?.voiceSubscribed == true, Turn.active.get(), permission())

        private fun wanted(): Boolean = Turn.wantsMic() || wantsWake()

        /** Open or close the mic to match the switches, the connection and any turn. Cheap; call whenever any of those change. */
        @Synchronized
        fun update() {
            app?.let { model = Kiosk.prefs(it).getString("esp_wake_model", model) ?: model }
            if (!EspLogic.wakeAllowed(switches())) dropModel()          // switched off: the model's memory is freed at once
            if (wanted() && worker == null) worker = thread(isDaemon = true, name = "esphome-mic") { loop() }
            showSign()
        }

        fun showSign() {
            val state = when {
                Turn.active.get() && Turn.thinking -> ListenSign.State.THINKING
                Turn.active.get() -> ListenSign.State.LISTENING
                open -> ListenSign.State.MIC_OPEN
                else -> ListenSign.State.OFF
            }
            Kiosk.main.post { Kiosk.activity?.showListenSign(state) }
        }

        private fun loop() {
            var rec: AudioRecord? = null
            var aec: AcousticEchoCanceler? = null
            try {
                val ctx = app ?: return
                val p = Kiosk.prefs(ctx)
                val src = when (p.getString("voice_source", "vr")) {
                    "mic" -> MediaRecorder.AudioSource.MIC
                    "vc" -> MediaRecorder.AudioSource.VOICE_COMMUNICATION
                    else -> MediaRecorder.AudioSource.VOICE_RECOGNITION
                }
                val min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
                if (min <= 0) { fail("no 16 kHz microphone input"); return }
                rec = AudioRecord(src, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min * 4, 6400))
                if (rec.state != AudioRecord.STATE_INITIALIZED) { fail("the microphone could not be opened"); return }
                if (p.getBoolean("voice_aec", false) && AcousticEchoCanceler.isAvailable()) {
                    aec = AcousticEchoCanceler.create(rec.audioSessionId)?.also { it.enabled = true }
                }
                rec.startRecording()
                open = true; showSign()
                Kiosk.log("voice", "mic opened")
                val buf = ShortArray(480)                                   // 30 ms
                val bytes = ByteArray(buf.size * 2)
                var listeningBefore = false
                while (wanted()) {
                    val n = rec.read(buf, 0, buf.size)
                    if (n < 0) { fail("reading the microphone failed (code $n)"); break }
                    if (n == 0) continue
                    for (i in 0 until n) { bytes[2 * i] = buf[i].toInt().toByte(); bytes[2 * i + 1] = (buf[i].toInt() shr 8).toByte() }
                    if (Turn.active.get()) {
                        Turn.audio(bytes, n * 2)
                        listeningBefore = false
                        continue
                    }
                    val listen = wantsWake() && !Turn.speaking()
                    listening = listen
                    if (!listen) { listeningBefore = false; continue }
                    val ww = wakeWord(ctx) ?: continue
                    if (!listeningBefore) { ww.reset(); listeningBefore = true }     // fresh state after a turn or a pause
                    val woke = synchronized(this) { wake === ww && ww.feed(buf, n) }     // never while the switch frees the model
                    if (woke) {
                        lastWakes = ww.wakes
                        Kiosk.log("voice", "wake word heard")
                        Turn.start("wake word", WakeLogic.model(model).phrase)?.let { lastTurn = "not started: $it" }
                        listeningBefore = false
                    }
                }
            } catch (e: Throwable) {
                fail("microphone error (" + e.javaClass.simpleName + ")")
            } finally {
                try { aec?.release() } catch (e: Exception) { }
                try { rec?.stop() } catch (e: Exception) { }
                try { rec?.release() } catch (e: Exception) { }
                open = false; listening = false
                synchronized(this) { worker = null }
                if (app != null) Kiosk.log("voice", "mic closed")
                showSign()
                if (wanted()) update()                                     // something asked for the mic while it was closing
            }
        }

        private fun fail(why: String) { lastError = why; Turn.stop(why) }

        @Synchronized
        private fun wakeWord(ctx: Context): WakeWord? {
            wake?.let { if (it.model.id == model) return it; it.close(); wake = null }
            return try { WakeWord(ctx, WakeLogic.model(model)).also { wake = it; wakeError = "" } }
            catch (e: Throwable) { wakeError = "the wake-word model did not load (" + e.javaClass.simpleName + ")"; null }
        }

        fun json(): String {
            val w = wake
            val m = WakeLogic.model(model)
            return "{\"model\":\"" + m.id + "\",\"phrase\":\"" + m.phrase + "\",\"listening\":" + listening + ",\"loaded\":" + (w != null) +
                ",\"wakes\":" + (w?.wakes ?: lastWakes) + ",\"peak\":" + String.format("%.2f", w?.peak ?: 0f) +
                ",\"model_ms_per_s\":" + String.format("%.1f", w?.msPerSecond() ?: 0.0) +
                ",\"error\":\"" + AudioLogic.jsonEscape(wakeError) + "\"}"
        }
    }

    // ---------------- one voice turn ----------------

    private object Turn {
        val active = AtomicBoolean(false)
        private val number = java.util.concurrent.atomic.AtomicLong(0)   // which turn is the current one (for its safety timer)
        @Volatile var owner: EspConnection? = null
        @Volatile private var streaming = false
        @Volatile var thinking = false
        @Volatile private var peakDb = -120.0
        @Volatile private var chunks = 0
        @Volatile private var ttsUntil = 0L                    // our answer is playing: no wake word meanwhile (it would hear itself)
        private val pending = ByteArrayOutputStream()          // audio after the wake word, before HA said "go ahead"
        private val chunk = ByteArrayOutputStream()

        fun wantsMic(): Boolean = active.get()

        fun speaking(): Boolean {
            if (ttsUntil == 0L) return false
            val playing = AudioPlayer.state == AudioLogic.State.BUFFERING || AudioPlayer.state == AudioLogic.State.PLAYING
            if (playing) return true
            if (Kiosk.mono() > ttsUntil) { ttsUntil = 0L; return false }
            return true
        }

        /** Start a turn. Returns null when it started, else why not. */
        fun start(source: String, wakePhrase: String = ""): String? {
            if (!voiceOn) return "voice is switched off"
            val c = client ?: return "Home Assistant is not connected"
            if (EspLogic.voiceFlags(switches(), c.kind) == 0) return "voice needs the encrypted connection (add the mirror in Home Assistant's ESPHome integration)"
            if (!c.voiceSubscribed) return "Home Assistant has not set up the voice assistant on this connection yet"
            val ctx = app ?: return "not ready"
            if (ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return "no microphone permission"
            if (!active.compareAndSet(false, true)) return "a turn is already running"
            val mine = number.incrementAndGet()
            owner = c; streaming = false; thinking = false; peakDb = -120.0; chunks = 0
            synchronized(pending) { pending.reset(); chunk.reset() }
            turns.incrementAndGet()
            lastTurn = "started ($source)"
            Kiosk.log("voice", "turn started ($source)")              // never what was said
            Mic.update()
            try { c.send(EspProto.VOICE_ASSISTANT_REQUEST, EspProto.voiceAssistantRequest(true, wakeWordPhrase = wakePhrase)) }
            catch (e: Exception) { stop("send failed"); return "send failed" }
            // safety net: if HA never answers, or never says speech ended, the mic closes anyway. It watches only THIS turn: before
            // Nov 21 a timer left over from the previous turn cut the next one off after a few seconds (and told HA to stop).
            val t0 = Kiosk.mono()
            thread(isDaemon = true) {
                while (true) {
                    Thread.sleep(500)
                    val myTurn = active.get() && owner === c && number.get() == mine
                    when (EspLogic.turnTimer(myTurn, thinking, Kiosk.mono() - t0, MAX_TURN_MS, MAX_ANSWER_MS)) {
                        EspLogic.TurnTimer.LEAVE -> return@thread
                        EspLogic.TurnTimer.WAIT -> continue
                        EspLogic.TurnTimer.GIVE_UP -> {
                            try { c.send(EspProto.VOICE_ASSISTANT_REQUEST, EspProto.voiceAssistantRequest(false)) } catch (e: Exception) { }
                            stop(if (thinking) "no answer from Home Assistant after ${(MAX_TURN_MS + MAX_ANSWER_MS) / 1000} s"
                                 else "timed out after ${MAX_TURN_MS / 1000} s")
                            return@thread
                        }
                    }
                }
            }
            return null
        }

        /** HA said yes (VoiceAssistantResponse): send what was said since the turn started, then keep streaming. */
        fun streamNow(c: EspConnection) {
            if (!active.get() || owner !== c || streaming) return
            val early = synchronized(pending) { val b = pending.toByteArray(); pending.reset(); b }
            var i = 0
            while (i < early.size) { val n = minOf(3200, early.size - i); send(c, early.copyOfRange(i, i + n)); i += n }
            streaming = true
        }

        /** Mic audio during a turn (16 kHz 16-bit mono little-endian), sent in 100 ms pieces once HA is ready. */
        fun audio(bytes: ByteArray, n: Int) {
            val c = owner ?: return
            if (!active.get() || thinking) return
            val db = EspProto.rmsDb(bytes, n); if (db > peakDb) peakDb = db
            if (!streaming) { synchronized(pending) { if (pending.size() + n <= PENDING_AUDIO_MAX) pending.write(bytes, 0, n) }; return }
            chunk.write(bytes, 0, n)
            if (chunk.size() >= 3200) { send(c, chunk.toByteArray()); chunk.reset() }
        }

        private fun send(c: EspConnection, pcm: ByteArray) {
            try { c.send(EspProto.VOICE_ASSISTANT_AUDIO, EspProto.voiceAudio(pcm)); chunks++ } catch (e: Exception) { stop("send failed") }
        }

        fun onEvent(c: EspConnection, type: Int, data: Map<String, String>) {
            if (owner !== c && type != EspProto.EV_TTS_END) return
            when (type) {
                EspProto.EV_STT_VAD_END, EspProto.EV_STT_END -> { streaming = false; thinking = true; Mic.showSign() }
                EspProto.EV_TTS_END -> {
                    val url = data["url"] ?: ""
                    if (AudioLogic.checkUrl(url) == null) app?.let {
                        ttsUntil = Kiosk.mono() + 60_000
                        AudioPlayer.play(it, url, "Assist", "", null, 0)
                    }
                }
                EspProto.EV_ERROR -> stop("Home Assistant: " + (data["code"] ?: "error"))
                EspProto.EV_RUN_END -> if (active.get()) stop("done")
            }
        }

        fun stop(why: String) {
            streaming = false
            if (!active.compareAndSet(true, false)) return
            owner = null; thinking = false
            synchronized(pending) { pending.reset(); chunk.reset() }
            if (ttsUntil != 0L) ttsUntil = Kiosk.mono() + 1500        // a short quiet spell after our own answer
            lastTurn = why + " (audio chunks " + chunks + ", loudest " + String.format("%.1f", peakDb) + " dBFS)"
            Kiosk.log("voice", "turn ended: $why")
            Mic.update()
        }

        /** HA's announce / start_conversation: play the media, say it finished, then start a turn if asked. */
        fun announce(c: EspConnection, media: String, startConversation: Boolean) {
            val ctx = app
            var ok = false
            if (ctx != null && voiceOn && AudioLogic.checkUrl(media) == null) {
                ttsUntil = Kiosk.mono() + 60_000
                AudioPlayer.play(ctx, media, "Assist", "", null, 0)
                val t0 = Kiosk.mono()
                Thread.sleep(500)
                while (Kiosk.mono() - t0 < 60_000 && (AudioPlayer.state == AudioLogic.State.BUFFERING || AudioPlayer.state == AudioLogic.State.PLAYING)) Thread.sleep(200)
                ok = AudioPlayer.state != AudioLogic.State.ERROR
                ttsUntil = Kiosk.mono() + 1500
            }
            try { c.send(EspProto.VOICE_ASSISTANT_ANNOUNCE_FINISHED, EspProto.announceFinished(ok)) } catch (e: Exception) { }
            if (startConversation && ok) start("start_conversation")?.let { lastTurn = "not started: $it" }
        }
    }

    /** GET /voice/test: start one turn now, as a tap would. */
    fun testTurn(): String? = Turn.start("test")

    // ---------------- status ----------------

    /** The `esphome` block of /status and GET /esphome: switches, state and counts. Never a key, an address or audio. */
    fun json(): String {
        val ctx = app ?: return "{\"bluetooth\":false,\"voice\":false,\"wake_word\":false,\"running\":false}"
        val c = client
        val s = switches()
        val rt = Runtime.getRuntime()
        return "{\"bluetooth\":" + btOn + ",\"voice\":" + voiceOn + ",\"wake_word\":" + wakeOn +
            ",\"encrypted\":" + s.hasKey + ",\"voice_state\":\"" + EspLogic.voiceState(s, c?.hello == true, c?.voiceSubscribed == true) + "\"" +
            ",\"running\":" + (server != null) + ",\"port\":" + PORT + ",\"name\":\"" + deviceName() + "\"" +
            ",\"ha_connected\":" + (c?.hello == true) + ",\"link\":\"" + (c?.kind?.name?.lowercase() ?: "none") + "\"" +
            ",\"connections\":" + connections.get() + ",\"refused\":" + refused.get() + ",\"wrong_key\":" + wrongKey.get() +
            ",\"plaintext_refused\":" + plaintextRefused.get() + ",\"lock_to_ha\":" + Kiosk.prefs(ctx).getBoolean("esp_lock", true) +
            ",\"mdns\":" + Nsd.registered +
            ",\"ble_subscribed\":" + Ble.subscribed + ",\"ble_scanning\":" + Ble.scanning + ",\"advertisements_sent\":" + advSent.get() +
            ",\"voice_subscribed\":" + (c?.voiceSubscribed == true) + ",\"mic_open\":" + Mic.open + ",\"turn_active\":" + Turn.active.get() +
            ",\"turns\":" + turns.get() + ",\"last_turn\":\"" + AudioLogic.jsonEscape(lastTurn) + "\"" +
            ",\"mic_source\":\"" + (Kiosk.prefs(ctx).getString("voice_source", "vr") ?: "vr") + "\",\"aec\":" + Kiosk.prefs(ctx).getBoolean("voice_aec", false) +
            ",\"wake\":" + Mic.json() +
            ",\"java_heap_kb\":" + ((rt.totalMemory() - rt.freeMemory()) / 1024) +
            ",\"native_heap_kb\":" + (android.os.Debug.getNativeHeapAllocatedSize() / 1024) +
            ",\"error\":\"" + AudioLogic.jsonEscape(lastError) + "\"}"
    }
}
