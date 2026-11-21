package com.nimrod.mirrorkiosk

import java.io.BufferedInputStream
import java.io.InputStream
import java.io.OutputStream
import java.io.PushbackInputStream
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * One Home Assistant connection to the mirror's ESPHome-style server: plaintext or Noise (chosen by the first byte), the
 * handshake, the core messages (hello, device info, ping, disconnect) and the encryption-key handover. Everything else (Bluetooth,
 * voice, wake word) goes to the Host. No Android in here, so EspWireTest runs this very code against ESPHome's own Python client.
 */
class EspConnection(private val sock: Socket, private val host: Host) {
    interface Host {
        fun switches(): EspLogic.Switches
        /** The 32-byte key, or null while Home Assistant has not handed one over yet. */
        fun key(): ByteArray?
        fun storeKey(key: ByteArray)
        fun deviceName(): String
        /** "AA:BB:CC:DD:EE:FF". */
        fun mac(): String
        fun deviceInfo(link: EspLogic.Link): EspProto.DeviceInfo
        /** A full (not handover) connection is ready: the host makes it THE connection, replacing any older one. */
        fun opened(c: EspConnection)
        fun closed(c: EspConnection)
        /** A message this class does not handle itself (only on full connections). */
        fun message(c: EspConnection, f: EspProto.Frame)
        /** Counts and plain-words problems for /esphome: "plaintext_refused", "wrong_key", "key_received", "key_refused". */
        fun note(event: String, detail: String = "")
    }

    private interface Transport {
        val kind: EspLogic.Link
        fun read(): EspProto.Frame?
        fun send(type: Int, payload: ByteArray)
    }

    private class Plain(private val input: InputStream, private val out: OutputStream) : Transport {
        override val kind = EspLogic.Link.PLAIN
        override fun read() = EspProto.readFrame(input)
        override fun send(type: Int, payload: ByteArray) { val f = EspProto.frame(type, payload); synchronized(out) { out.write(f); out.flush() } }
    }

    private class Encrypted(private val s: EspNoise.Session, provisioning: Boolean) : Transport {
        override val kind = if (provisioning) EspLogic.Link.PROVISIONING else EspLogic.Link.ENCRYPTED
        override fun read() = s.read()
        override fun send(type: Int, payload: ByteArray) = s.send(type, payload)
    }

    private val closed = AtomicBoolean(false)
    @Volatile private var transport: Transport? = null
    @Volatile var hello = false; private set
    /** Set by the host when HA subscribes to the voice assistant on this connection. */
    @Volatile var voiceSubscribed = false

    val kind: EspLogic.Link get() = transport?.kind ?: EspLogic.Link.PLAIN
    val isOpen: Boolean get() = !closed.get()

    fun send(type: Int, payload: ByteArray) { (transport ?: throw IllegalStateException("not connected")).send(type, payload) }

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        try { sock.close() } catch (e: Exception) { }
        host.closed(this)
    }

    /** Blocks until the connection ends. */
    fun run(idleTimeoutMs: Int) {
        try {
            sock.tcpNoDelay = true
            sock.soTimeout = idleTimeoutMs
            val input = PushbackInputStream(BufferedInputStream(sock.getInputStream()), 1)
            val out = sock.getOutputStream()
            val first = input.read()
            if (first < 0) return
            transport = when (first) {
                0x00 -> {
                    if (!EspLogic.acceptsPlaintext(host.switches())) {
                        host.note("plaintext_refused")
                        out.write(EspNoise.rejection("Bad indicator byte")); out.flush()      // aioesphomeapi: "requires encryption"
                        return
                    }
                    input.unread(first)
                    Plain(input, out)
                }
                0x01 -> {
                    val k = host.key()
                    try {
                        Encrypted(EspNoise.accept(input, out, k ?: EspNoise.ZERO_KEY, host.deviceName(), EspProto.plainMac(host.mac())), provisioning = k == null)
                    } catch (e: EspNoise.HandshakeFailed) {
                        host.note("wrong_key", if (k == null) "a client used an encryption key, but the mirror has none yet" else "a client used the wrong encryption key")
                        return
                    }
                }
                else -> return
            }
            if (kind != EspLogic.Link.PROVISIONING) host.opened(this)
            while (!closed.get()) {
                val f = transport!!.read() ?: break
                handle(f)
            }
        } catch (e: Exception) {
            // dropped connection, a timeout, or a frame that did not decrypt
        } finally { close() }
    }

    private fun handle(f: EspProto.Frame) {
        when (f.type) {
            EspProto.HELLO_REQUEST -> { hello = true; send(EspProto.HELLO_RESPONSE, EspProto.helloResponse(host.deviceName())) }
            EspProto.DEVICE_INFO_REQUEST -> send(EspProto.DEVICE_INFO_RESPONSE, EspProto.deviceInfoResponse(host.deviceInfo(kind)))
            EspProto.PING_REQUEST -> send(EspProto.PING_RESPONSE, ByteArray(0))
            EspProto.DISCONNECT_REQUEST -> { try { send(EspProto.DISCONNECT_RESPONSE, ByteArray(0)) } catch (e: Exception) { }; close() }
            EspProto.DISCONNECT_RESPONSE -> close()
            EspProto.NOISE_SET_KEY_REQUEST -> setKey(f.payload)
            EspProto.LIST_ENTITIES_REQUEST -> if (kind != EspLogic.Link.PROVISIONING) send(EspProto.LIST_ENTITIES_DONE, ByteArray(0))
            else -> if (kind != EspLogic.Link.PROVISIONING) host.message(this, f)     // the handover connection may only hand over the key
        }
    }

    private fun setKey(payload: ByteArray) {
        val s = host.switches()
        val newKey = if (EspLogic.maySetKey(kind, s)) EspLogic.decodeKey(EspProto.parseSetKey(payload)) else null
        if (newKey == null) {
            host.note("key_refused", if (!EspLogic.maySetKey(kind, s)) "refused a key change over this connection" else "Home Assistant sent a key that is not 32 bytes")
            send(EspProto.NOISE_SET_KEY_RESPONSE, EspProto.setKeyResponse(false))
            return
        }
        host.storeKey(newKey)
        host.note("key_received")                                     // never the key itself
        send(EspProto.NOISE_SET_KEY_RESPONSE, EspProto.setKeyResponse(true))
    }

    companion object {
        /**
         * After a key was handed over, ask the older plaintext connection to reconnect (as ESPHome firmware does), so Home Assistant
         * comes back encrypted with the key it just stored. HA updates its entry right after our answer; half a second is plenty.
         */
        fun reconnectPlain(main: EspConnection?) {
            if (main == null || main.kind != EspLogic.Link.PLAIN) return
            thread(isDaemon = true) {
                Thread.sleep(500)
                try { main.send(EspProto.DISCONNECT_REQUEST, ByteArray(0)) } catch (e: Exception) { }
                Thread.sleep(1000)
                main.close()
            }
        }
    }
}
