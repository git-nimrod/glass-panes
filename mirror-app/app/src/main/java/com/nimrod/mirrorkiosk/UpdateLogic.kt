package com.nimrod.mirrorkiosk

/**
 * The rules for installing a new version of this app that Home Assistant pushes to the mirror (POST /update/install, see AppUpdate.kt).
 * Pure Kotlin, so every rule is unit-tested without a device.
 *
 * The mirror never fetches anything from the internet for this: Home Assistant downloads the release from GitHub, checks it, and sends
 * the file over the home network to the control port. (Android 6's own certificate store is too old for many sites, and the mirror
 * should not need the internet at all.) The mirror then checks it again by itself, and only installs it when ALL of these hold:
 *  - the bytes it received have exactly the SHA-256 Home Assistant said they would (no cut-off or changed file);
 *  - it is this app (same package name), and a NEWER version (Android refuses downgrades anyway);
 *  - it is signed with exactly the same certificate(s) as the app that is installed now. So only the project's release key can update a
 *    release install; a stranger on the network who somehow had the control key still could not install anything else.
 */
object UpdateLogic {
    const val MAX_BYTES = 200L * 1024 * 1024          // a release APK is about 90 MB; anything far bigger is not ours
    const val MIN_BYTES = 1024L

    private val HEX64 = Regex("^[0-9a-f]{64}$")

    /** Lower-case hex of some bytes (the SHA-256 we compare). */
    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }

    /** Checks the upload's announced size and hash before a single byte is written. Null when fine, otherwise a reason. */
    fun requestProblem(sha256: String?, contentLength: Long, freeBytes: Long): String? {
        if (sha256 == null || !HEX64.matches(sha256)) return "send ?sha256= with the file's SHA-256 (64 lower-case hex characters)"
        if (contentLength < 0) return "the upload has no Content-Length"
        if (contentLength < MIN_BYTES) return "that file is far too small to be the app"
        if (contentLength > MAX_BYTES) return "that file is far too big to be the app"
        // the file is written once, then Android copies it while installing: keep room for both and some to spare
        if (freeBytes in 0 until contentLength * 3) return "not enough free storage on the mirror for the update"
        return null
    }

    /**
     * Whether a received APK may be installed over the app that runs now. Null when it may, otherwise the reason it may not.
     * [newSigners] and [installedSigners] are the SHA-256 of each signing certificate (as Android reports them).
     */
    fun installProblem(
        receivedSha256: String, expectedSha256: String,
        newPackage: String?, ownPackage: String,
        newVersionCode: Int, installedVersionCode: Int,
        newSigners: Set<String>, installedSigners: Set<String>,
    ): String? {
        if (receivedSha256 != expectedSha256) return "the file that arrived does not match its SHA-256 (cut off or changed on the way)"
        if (newPackage == null) return "that file is not an Android app Android can read"
        if (newPackage != ownPackage) return "that app is not the Mirror Kiosk app"
        if (newVersionCode <= installedVersionCode) return "that version is not newer than the one installed (" + newVersionCode + " is not above " + installedVersionCode + ")"
        if (installedSigners.isEmpty() || newSigners.isEmpty()) return "could not read who signed the app"
        if (newSigners != installedSigners) return "that app is not signed with the same key as the installed one"
        return null
    }

    /** The /update answer: what the updater is doing, safe to show. */
    fun json(canInstall: Boolean, state: String, detail: String, received: Long, total: Long, versionCode: Int, signers: Set<String>): String =
        "{\"can_install\":" + canInstall + ",\"state\":\"" + safe(state) + "\",\"detail\":\"" + safe(detail) + "\"," +
            "\"received_bytes\":" + received + ",\"total_bytes\":" + total + ",\"version_code\":" + versionCode + "," +
            "\"cert_sha256\":[" + signers.sorted().joinToString(",") { "\"" + safe(it) + "\"" } + "]}"

    /** Text for a JSON string: no quotes, backslashes or control characters, at most 200 characters. */
    fun safe(s: String): String = s.map { if (it == '"' || it == '\\' || it.code < 32) '\'' else it }.joinToString("").take(200)
}
