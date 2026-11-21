package com.nimrod.mirrorkiosk

import com.southernstorm.noise.protocol.CipherState
import com.southernstorm.noise.protocol.DHState
import com.southernstorm.noise.protocol.Noise
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * ESPHome's encrypted API transport, the device (server) side: the Noise protocol `Noise_NNpsk0_25519_ChaChaPoly_SHA256` with the
 * prologue "NoiseAPIInit\0\0", exactly as ESPHome firmware and its Python client (aioesphomeapi `_frame_helper/noise.py`) do it.
 *
 * The two parties share a 32-byte key (the "encryption key" Home Assistant shows in the ESPHome entry). Each connection makes fresh
 * X25519 keys, so recorded traffic cannot be read later even with the shared key, and a wrong key fails the handshake.
 * Curve25519, ChaCha20-Poly1305 and SHA-256 come from noise-java (Signal's MIT-licensed build, `org.signal.forks:noise-java`,
 * pure Java, so it works on Android 6, which has none of these ciphers built in). noise-java has no `psk0` patterns, so the
 * handshake itself (one message each way) is written here from the Noise specification, revision 34, section 9.
 *
 * Wire format (all frames start with 0x01, then a 2-byte big-endian length, then that many bytes):
 *   client -> server  hello frame (empty), then  [0x00] + handshake message 1 (e, 32 bytes + 16-byte tag)
 *   server -> client  [0x01] + name + 0x00 + mac + 0x00   (the "server hello": protocol 1, the device name and MAC)
 *   server -> client  [0x00] + handshake message 2 (e, 32 bytes + 16-byte tag), or [0x01] + "reason" when the handshake failed
 *   then each message both ways is encrypt([type hi, type lo, len hi, len lo] + protobuf payload)
 *
 * Pure Kotlin (no Android classes), so it is tested on a PC against itself and against the real aioesphomeapi client.
 */
object EspNoise {
    const val PROTOCOL = "Noise_NNpsk0_25519_ChaChaPoly_SHA256"
    val PROLOGUE = "NoiseAPIInit".toByteArray(Charsets.US_ASCII) + byteArrayOf(0, 0)
    /** The all-zero key: a device with no key yet accepts it, only so Home Assistant can hand over a real key unseen (see EspServer). */
    val ZERO_KEY = ByteArray(32)
    private const val MAX_FRAME = 0xFFFF
    private const val TAG = 16

    class HandshakeFailed(message: String) : Exception(message)

    // ---------------- framing ----------------

    /** One noise frame's bytes after the 0x01 marker (the caller has checked the marker), or null at a clean end of stream. */
    fun readFrame(input: InputStream, markerRead: Boolean = false): ByteArray? {
        if (!markerRead) {
            val m = input.read()
            if (m < 0) return null
            if (m != 0x01) throw HandshakeFailed("Bad indicator byte")
        }
        val hi = input.read(); val lo = input.read()
        if (hi < 0 || lo < 0) throw EOFException()
        val len = (hi shl 8) or lo
        val out = ByteArray(len)
        var got = 0
        while (got < len) { val n = input.read(out, got, len - got); if (n < 0) throw EOFException(); got += n }
        return out
    }

    fun frame(payload: ByteArray): ByteArray {
        require(payload.size <= MAX_FRAME)
        return byteArrayOf(0x01, (payload.size shr 8).toByte(), payload.size.toByte()) + payload
    }

    /** The server hello: protocol 1, the device name and MAC (12 lower-case hex digits, as ESPHome sends them). */
    fun serverHello(name: String, mac: String): ByteArray =
        byteArrayOf(0x01) + name.toByteArray(Charsets.UTF_8) + byteArrayOf(0) + mac.toByteArray(Charsets.US_ASCII) + byteArrayOf(0)

    /** What a refusal looks like on the wire: 0x01 + a short reason. "Handshake MAC failure" is what a wrong key gets. */
    fun rejection(reason: String): ByteArray = frame(byteArrayOf(0x01) + reason.toByteArray(Charsets.US_ASCII))

    // ---------------- Noise symmetric state (spec section 5.2) ----------------

    private class Symmetric {
        var ck = ByteArray(32)
        var h = ByteArray(32)
        val cipher: CipherState = Noise.createCipher("ChaChaPoly")
        var hasKey = false

        init {
            val name = PROTOCOL.toByteArray(Charsets.US_ASCII)
            h = if (name.size <= 32) name.copyOf(32) else sha256(name)
            ck = h.copyOf()
            mixHash(PROLOGUE)
        }

        fun mixHash(data: ByteArray) { h = sha256(h + data) }

        fun mixKey(ikm: ByteArray) {
            val (a, b) = hkdf(ck, ikm, 2)
            ck = a; cipher.initializeKey(b, 0); hasKey = true
        }

        fun mixKeyAndHash(ikm: ByteArray) {
            val out = hkdf(ck, ikm, 3)
            ck = out[0]; mixHash(out[1]); cipher.initializeKey(out[2], 0); hasKey = true
        }

        fun encryptAndHash(plain: ByteArray): ByteArray {
            val out = ByteArray(plain.size + TAG)
            val n = cipher.encryptWithAd(h, plain, 0, out, 0, plain.size)
            val c = out.copyOf(n)
            mixHash(c)
            return c
        }

        fun decryptAndHash(c: ByteArray): ByteArray {
            val out = ByteArray(c.size)
            val n = try { cipher.decryptWithAd(h, c, 0, out, 0, c.size) } catch (e: Exception) { throw HandshakeFailed("Handshake MAC failure") }
            mixHash(c)
            return out.copyOf(n)
        }

        /** The two transport keys: the first is the initiator's (client's) sending key. */
        fun split(): Pair<ByteArray, ByteArray> { val (a, b) = hkdf(ck, ByteArray(0), 2); return a to b }
    }

    private fun sha256(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(b)

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }

    private fun hkdf(ck: ByteArray, ikm: ByteArray, outputs: Int): List<ByteArray> {
        val temp = hmac(ck, ikm)
        val o1 = hmac(temp, byteArrayOf(1))
        val o2 = hmac(temp, o1 + byteArrayOf(2))
        return if (outputs == 2) listOf(o1, o2) else listOf(o1, o2, hmac(temp, o2 + byteArrayOf(3)))
    }

    // ---------------- an encrypted connection, after the handshake ----------------

    /** Sends and reads ESPHome messages over an established Noise session. `send` is thread-safe (Bluetooth, mic and HA all send). */
    class Session internal constructor(private val input: InputStream, private val output: OutputStream, sendKey: ByteArray, recvKey: ByteArray) {
        private val tx: CipherState = Noise.createCipher("ChaChaPoly").also { it.initializeKey(sendKey, 0) }
        private val rx: CipherState = Noise.createCipher("ChaChaPoly").also { it.initializeKey(recvKey, 0) }

        fun send(type: Int, payload: ByteArray) {
            val plain = ByteArray(4 + payload.size)
            plain[0] = (type shr 8).toByte(); plain[1] = type.toByte()
            plain[2] = (payload.size shr 8).toByte(); plain[3] = payload.size.toByte()
            System.arraycopy(payload, 0, plain, 4, payload.size)
            synchronized(this) {
                val c = ByteArray(plain.size + TAG)
                val n = tx.encryptWithAd(null, plain, 0, c, 0, plain.size)
                output.write(frame(c.copyOf(n)))
                output.flush()
            }
        }

        /** The next message, or null at a clean end of stream. A frame that does not decrypt ends the connection (an exception). */
        fun read(): EspProto.Frame? {
            val c = readFrame(input) ?: return null
            val p = ByteArray(c.size)
            val n = try { rx.decryptWithAd(null, c, 0, p, 0, c.size) } catch (e: Exception) { throw HandshakeFailed("decryption failed") }
            if (n < 4) throw HandshakeFailed("message too short")
            val type = ((p[0].toInt() and 0xFF) shl 8) or (p[1].toInt() and 0xFF)
            val len = ((p[2].toInt() and 0xFF) shl 8) or (p[3].toInt() and 0xFF)
            if (len > n - 4) throw HandshakeFailed("bad message length")
            return EspProto.Frame(type, p.copyOfRange(4, 4 + len))
        }
    }

    // ---------------- the handshake ----------------

    /**
     * Run the device side of the handshake on a connection whose first byte (0x01) was already read. `key` is the shared key
     * (ZERO_KEY while the device has none). On a wrong key the client is told "Handshake MAC failure" and HandshakeFailed is thrown.
     */
    fun accept(input: InputStream, output: OutputStream, key: ByteArray, name: String, mac: String): Session {
        require(key.size == 32)
        readFrame(input, markerRead = true)                          // client hello: its content is not used
        output.write(frame(serverHello(name, mac))); output.flush()
        val msg = readFrame(input) ?: throw EOFException()
        try {
            if (msg.isEmpty() || msg[0].toInt() != 0) throw HandshakeFailed("Bad handshake frame")
            if (msg.size != 1 + 32 + TAG) throw HandshakeFailed("Bad handshake message length")
            val s = Symmetric()
            // <- psk, e
            s.mixKeyAndHash(key)
            val re = msg.copyOfRange(1, 33)
            s.mixHash(re); s.mixKey(re)                              // psk mode: e also mixes into the key
            s.decryptAndHash(msg.copyOfRange(33, msg.size))          // the (empty) payload: proves the client has the key
            // -> e, ee
            val e: DHState = Noise.createDH("25519")
            e.generateKeyPair()
            val epub = ByteArray(32).also { e.getPublicKey(it, 0) }
            s.mixHash(epub); s.mixKey(epub)
            val remote: DHState = Noise.createDH("25519").also { it.setPublicKey(re, 0) }
            val shared = ByteArray(32).also { e.calculate(it, 0, remote) }
            e.destroy()
            s.mixKey(shared)
            val tag = s.encryptAndHash(ByteArray(0))
            output.write(frame(byteArrayOf(0x00) + epub + tag)); output.flush()
            val (clientToServer, serverToClient) = s.split()
            return Session(input, output, sendKey = serverToClient, recvKey = clientToServer)
        } catch (e: HandshakeFailed) {
            try { output.write(rejection(e.message ?: "Handshake failed")); output.flush() } catch (x: Exception) { }
            throw e
        }
    }

    /**
     * The client side, used only by the tests (and to show the two sides agree). Home Assistant uses aioesphomeapi's own.
     * Returns the session and the server hello's (name, mac).
     */
    fun connect(input: InputStream, output: OutputStream, key: ByteArray): Pair<Session, Pair<String, String>> {
        val s = Symmetric()
        val e: DHState = Noise.createDH("25519"); e.generateKeyPair()
        val epub = ByteArray(32).also { e.getPublicKey(it, 0) }
        s.mixKeyAndHash(key)
        s.mixHash(epub); s.mixKey(epub)
        val tag = s.encryptAndHash(ByteArray(0))
        output.write(frame(ByteArray(0))); output.write(frame(byteArrayOf(0x00) + epub + tag)); output.flush()
        val hello = readFrame(input) ?: throw EOFException()
        val zero1 = hello.indexOf(0, 1); val zero2 = if (zero1 < 0) -1 else hello.indexOf(0, zero1 + 1)
        val name = if (zero1 > 0) String(hello, 1, zero1 - 1, Charsets.UTF_8) else ""
        val mac = if (zero2 > zero1) String(hello, zero1 + 1, zero2 - zero1 - 1, Charsets.US_ASCII) else ""
        val reply = readFrame(input) ?: throw EOFException()
        if (reply.isEmpty() || reply[0].toInt() != 0) throw HandshakeFailed(String(reply, 1, maxOf(0, reply.size - 1), Charsets.US_ASCII))
        val re = reply.copyOfRange(1, 33)
        s.mixHash(re); s.mixKey(re)
        val remote: DHState = Noise.createDH("25519").also { it.setPublicKey(re, 0) }
        val shared = ByteArray(32).also { e.calculate(it, 0, remote) }
        s.mixKey(shared)
        s.decryptAndHash(reply.copyOfRange(33, reply.size))
        val (clientToServer, serverToClient) = s.split()
        return Session(input, output, sendKey = clientToServer, recvKey = serverToClient) to (name to mac)
    }

    private fun ByteArray.indexOf(b: Byte, from: Int): Int { for (i in from until size) if (this[i] == b) return i; return -1 }
}
