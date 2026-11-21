package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** /status tells Home Assistant which kiosk API, platform, board and calls this app has. */
class KioskContractTest {
    @Test fun boardNamesAreShortAndSafe() {
        assertEquals("msm8916", KioskContract.board("MSM8916"))
        assertEquals("unknown", KioskContract.board(null))
        assertEquals("unknown", KioskContract.board("\"}{"))
        assertEquals("ab", KioskContract.board("a\"b"))
        assertEquals(40, KioskContract.board("x".repeat(100)).length)
    }

    @Test fun statusFieldsAreValidJsonPieces() {
        val json = "{" + KioskContract.statusFields("msm8916") + "}"
        assertTrue(json.startsWith("{\"platform\":\"android\",\"board\":\"msm8916\",\"kiosk_api\":1,\"capabilities\":[\"status\","))
        assertTrue(json.endsWith("\"engine\",\"esphome\",\"bluetooth_proxy\",\"voice\",\"wake_word\"]}"))
    }

    @Test fun appUpdateIsListedOnlyWhenTheMirrorCanInstall() {
        assertTrue(KioskContract.statusFields("msm8916", listOf("app_update")).endsWith("\"wake_word\",\"app_update\"]"))
        assertTrue(KioskContract.statusFields("msm8916", emptyList()).endsWith("\"wake_word\"]"))
        assertTrue("unknown extras are dropped", KioskContract.statusFields("msm8916", listOf("rm_rf")).endsWith("\"wake_word\"]"))
    }

    @Test fun everyCapabilityIsInTheContractAndEveryRequiredOneIsListed() {
        // the contract lives in the integration; read it from the repository when the test runs from mirror-app/app
        val file = listOf("../../custom_components/glass_panes/schema/kiosk_api.json", "../custom_components/glass_panes/schema/kiosk_api.json")
            .map { File(it) }.firstOrNull { it.isFile } ?: return            // not in the full repository: nothing to compare with
        val text = file.readText()
        val names = Regex(""""([a-z_]+)": \{ "required": (true|false)""").findAll(text).map { it.groupValues[1] to (it.groupValues[2] == "true") }.toList()
        assertTrue(names.size >= 10)
        for (c in KioskContract.CAPABILITIES + KioskContract.OPTIONAL_AT_RUNTIME) assertTrue("$c is not in kiosk_api.json", names.any { it.first == c })
        for ((name, required) in names) if (required) assertTrue("required $name missing", name in KioskContract.CAPABILITIES)
        assertTrue(text.contains("\"kiosk_api\": " + KioskContract.API + ","))
    }
}
