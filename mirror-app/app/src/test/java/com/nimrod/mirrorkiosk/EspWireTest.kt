package com.nimrod.mirrorkiosk

import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * Optional check against ESPHome's real Python client (aioesphomeapi), skipped unless ESP_E2E=1. It serves the app's own
 * connection code (EspConnection, EspNoise, EspProto, EspLogic) on 127.0.0.1:16053 with a stand-in for the Android parts, then
 * waits for mirror-app/tools/esp_e2e.py to walk Home Assistant's steps (plaintext, the key handover, encrypted). In another window:
 *   py tools/esp_e2e.py 127.0.0.1 16053
 */
class EspWireTest {
    @Test fun homeAssistantsStepsWithTheRealClient() {
        assumeTrue(System.getenv("ESP_E2E") == "1")
        val mac = "FE:01:02:03:04:05"
        var key: ByteArray? = null
        var main: EspConnection? = null
        val keys = AtomicInteger(); val wrong = AtomicInteger(); val plainRefused = AtomicInteger(); val configs = AtomicInteger()
        val host = object : EspConnection.Host {
            override fun switches() = EspLogic.Switches(bluetooth = true, voice = true, wake = true, hasKey = key != null)
            override fun key() = key
            @Suppress("PARAMETER_NAME_CHANGED_ON_OVERRIDE")
            override fun storeKey(k: ByteArray) { val old = main; key = k; EspConnection.reconnectPlain(old) }
            override fun deviceName() = EspProto.deviceName(mac)
            override fun mac() = mac
            override fun deviceInfo(link: EspLogic.Link) = EspProto.DeviceInfo(deviceName(), "Glass Panes mirror", mac, EspLogic.bluetoothMac(mac),
                "2025.9.0", EspLogic.bluetoothFlags(switches(), link), EspLogic.voiceFlags(switches(), link), true, key == null)
            override fun opened(c: EspConnection) { main = c }
            override fun closed(c: EspConnection) { if (main === c) main = null }
            override fun note(event: String, detail: String) {
                when (event) { "key_received" -> keys.incrementAndGet(); "wrong_key" -> wrong.incrementAndGet(); "plaintext_refused" -> plainRefused.incrementAndGet() }
            }
            override fun message(c: EspConnection, f: EspProto.Frame) {
                when (f.type) {
                    EspProto.SUBSCRIBE_BLE_ADVERTISEMENTS -> {
                        val ads = (1..20).map { EspProto.Adv(0xAABBCCDDEE00L + (it % 5), -40 - it, byteArrayOf(2, 1, 6, 3, 3, 0x0F, 0x18)) }
                        for (chunk in ads.chunked(EspProto.ADV_BATCH)) c.send(EspProto.BLE_RAW_ADVERTISEMENTS, EspProto.rawAdvertisements(chunk))
                    }
                    EspProto.VOICE_ASSISTANT_CONFIG_REQUEST -> {
                        configs.incrementAndGet()
                        val allowed = EspLogic.wakeAllowed(switches()) && EspLogic.voiceFlags(switches(), c.kind) != 0
                        c.send(EspProto.VOICE_ASSISTANT_CONFIG_RESPONSE, EspProto.configurationResponse(
                            if (allowed) WakeLogic.MODELS.map { EspProto.WakeWordInfo(it.id, it.phrase, it.languages) } else emptyList(),
                            if (allowed) listOf(WakeLogic.DEFAULT_MODEL) else emptyList(), if (allowed) 1 else 0))
                    }
                }
            }
        }
        val server = ServerSocket(16053, 8, InetAddress.getLoopbackAddress())
        server.soTimeout = 1000
        val deadline = System.currentTimeMillis() + 180_000
        while (System.currentTimeMillis() < deadline && configs.get() == 0) {
            val sock = try { server.accept() } catch (e: java.net.SocketTimeoutException) { continue }
            thread(isDaemon = true) { EspConnection(sock, host).run(30_000) }
        }
        Thread.sleep(500)
        server.close()
        assertTrue("the key was handed over", keys.get() == 1)
        assertTrue("plaintext was refused after it", plainRefused.get() >= 1)
        assertTrue("a wrong key was refused", wrong.get() >= 1)
        assertTrue("the wake-word list was asked for", configs.get() >= 1)
    }
}
