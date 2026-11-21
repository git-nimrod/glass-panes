package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rules for installing an update Home Assistant pushes (UpdateLogic): only our app, only newer, only the same signing key. */
class UpdateLogicTest {
    private val sha = "a".repeat(64)
    private val key = setOf("f01c1695256290f39fb5d552538aed723434157ffd4714ac6a19bf169af58dba")
    private val own = "com.nimrod.mirrorkiosk"

    private fun decide(
        received: String = sha, pkg: String? = own, code: Int = 1300, installed: Int = 1200,
        newSigners: Set<String> = key, oldSigners: Set<String> = key,
    ) = UpdateLogic.installProblem(received, sha, pkg, own, code, installed, newSigners, oldSigners)

    @Test fun aNewerReleaseWithTheSameKeyIsInstalled() = assertNull(decide())

    @Test fun aCutOffOrChangedFileIsRefused() = assertNotNull(decide(received = "b".repeat(64)))

    @Test fun anotherAppIsRefused() {
        assertNotNull(decide(pkg = "com.example.other"))
        assertNotNull(decide(pkg = null))
    }

    @Test fun theSameOrAnOlderVersionIsRefused() {
        assertNotNull(decide(code = 1200))
        assertNotNull(decide(code = 1100))
    }

    @Test fun anotherSigningKeyIsRefused() {
        assertNotNull(decide(newSigners = setOf("0".repeat(64))))
        assertNotNull(decide(newSigners = key + "0".repeat(64)))         // an extra signer is not "the same key"
        assertNotNull(decide(newSigners = emptySet()))
        assertNotNull(decide(oldSigners = emptySet()))
    }

    @Test fun theUploadIsCheckedBeforeAnythingIsWritten() {
        assertNull(UpdateLogic.requestProblem(sha, 90_000_000, 2_000_000_000))
        assertNotNull("no hash", UpdateLogic.requestProblem(null, 90_000_000, 2_000_000_000))
        assertNotNull("upper-case hash", UpdateLogic.requestProblem("A".repeat(64), 90_000_000, 2_000_000_000))
        assertNotNull("short hash", UpdateLogic.requestProblem("a".repeat(63), 90_000_000, 2_000_000_000))
        assertNotNull("no length", UpdateLogic.requestProblem(sha, -1, 2_000_000_000))
        assertNotNull("tiny", UpdateLogic.requestProblem(sha, 10, 2_000_000_000))
        assertNotNull("huge", UpdateLogic.requestProblem(sha, UpdateLogic.MAX_BYTES + 1, Long.MAX_VALUE))
        assertNotNull("no room", UpdateLogic.requestProblem(sha, 90_000_000, 200_000_000))
    }

    @Test fun hexIsLowerCaseAndPadded() {
        assertEquals("000fff", UpdateLogic.hex(byteArrayOf(0, 15, -1)))
    }

    @Test fun theStatusIsSafeJson() {
        val json = UpdateLogic.json(true, "failed", "a \"quoted\" \\ reason\n", 5, 10, 1300, key)
        assertTrue(json.startsWith("{\"can_install\":true,\"state\":\"failed\",\"detail\":\"a 'quoted' ' reason'\""))
        assertTrue(json.endsWith("\"version_code\":1300,\"cert_sha256\":[\"" + key.first() + "\"]}"))
    }
}
