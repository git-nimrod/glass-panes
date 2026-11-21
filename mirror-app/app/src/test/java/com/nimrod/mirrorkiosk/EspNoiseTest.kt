package com.nimrod.mirrorkiosk

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/** The device side of ESPHome's Noise handshake against the client side, over a loopback socket. EspWireTest checks it against aioesphomeapi. */
class EspNoiseTest {
    private fun key(b: Int) = ByteArray(32) { (it * 7 + b).toByte() }

    private class Run(val client: Result<Pair<EspNoise.Session, Pair<String, String>>>, val server: EspNoise.Session?, val error: Throwable?)

    /** A real loopback connection (pipes die with their reading thread), the server side in its own thread. */
    private fun handshake(serverKey: ByteArray, clientKey: ByteArray): Run {
        val listener = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        var server: EspNoise.Session? = null; var error: Throwable? = null
        val t = thread {
            try {
                val s = listener.accept()
                val input = s.getInputStream()
                assertEquals(1, input.read())
                server = EspNoise.accept(input, s.getOutputStream(), serverKey, "glass-panes-abcdef", "fe0102030405")
            } catch (e: Throwable) { error = e }
        }
        val sock = Socket(InetAddress.getLoopbackAddress(), listener.localPort)
        val client = runCatching { EspNoise.connect(sock.getInputStream(), sock.getOutputStream(), clientKey) }
        t.join(5000)
        listener.close()
        return Run(client, server, error)
    }

    @Test fun sameKeyTalksBothWays() {
        val r = handshake(key(1), key(1))
        assertEquals(null, r.error)
        val (c, hello) = r.client.getOrThrow()
        assertEquals("glass-panes-abcdef" to "fe0102030405", hello)
        val msg = "ha!".toByteArray()
        c.send(EspProto.HELLO_REQUEST, msg)
        val got = r.server!!.read()!!
        assertEquals(EspProto.HELLO_REQUEST, got.type)
        assertArrayEquals(msg, got.payload)
        val big = ByteArray(3200) { it.toByte() }
        r.server.send(EspProto.VOICE_ASSISTANT_AUDIO, big)
        r.server.send(EspProto.PING_RESPONSE, ByteArray(0))
        val a = c.read()!!; val b = c.read()!!
        assertEquals(EspProto.VOICE_ASSISTANT_AUDIO, a.type); assertArrayEquals(big, a.payload)
        assertEquals(EspProto.PING_RESPONSE, b.type); assertEquals(0, b.payload.size)
    }

    @Test fun wrongKeyIsRefusedWithTheWordsHomeAssistantLooksFor() {
        val r = handshake(key(1), key(2))
        assertEquals(null, r.server)
        assertTrue(r.error is EspNoise.HandshakeFailed)
        val e = r.client.exceptionOrNull()
        assertTrue(e is EspNoise.HandshakeFailed && e.message == "Handshake MAC failure")
    }

    @Test fun theZeroKeyIsJustAnotherKey() {
        val r = handshake(EspNoise.ZERO_KEY, EspNoise.ZERO_KEY)
        assertEquals(null, r.error)
        assertTrue(r.client.isSuccess)
        val r2 = handshake(key(3), EspNoise.ZERO_KEY)             // a mirror with a key refuses the handover key
        assertEquals(null, r2.server); assertTrue(r2.error is EspNoise.HandshakeFailed)
    }

    @Test fun framesAndHelloLayout() {
        assertArrayEquals(byteArrayOf(1, 0, 2, 7, 8), EspNoise.frame(byteArrayOf(7, 8)))
        val hello = EspNoise.serverHello("n", "aabb")
        assertArrayEquals(byteArrayOf(1) + "n".toByteArray() + byteArrayOf(0) + "aabb".toByteArray() + byteArrayOf(0), hello)
        val r = EspNoise.rejection("Handshake MAC failure")
        assertEquals(1, r[0].toInt()); assertEquals(1, r[3].toInt())
        try { EspNoise.readFrame(java.io.ByteArrayInputStream(byteArrayOf(0, 0, 0))); fail() } catch (e: EspNoise.HandshakeFailed) { }
    }
}
