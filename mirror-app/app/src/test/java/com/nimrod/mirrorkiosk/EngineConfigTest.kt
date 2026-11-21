package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The engine's memory switches (EngineConfig): nothing changes unless one is turned off. */
class EngineConfigTest {
    @Test fun bothOnMeansNoFileAtAll() = assertNull(EngineConfig.yaml(gpuProcess = true, crashHelper = true))

    @Test fun eachSwitchWritesOnlyItsOwnLine() {
        val gpu = EngineConfig.yaml(gpuProcess = false, crashHelper = true)!!
        assertTrue(gpu.contains("prefs:\n  layers.gpu-process.enabled: false\n"))
        assertFalse(gpu.contains("MOZ_CRASHREPORTER_DISABLE"))
        val crash = EngineConfig.yaml(gpuProcess = true, crashHelper = false)!!
        assertTrue(crash.contains("env:\n  MOZ_CRASHREPORTER_DISABLE: 1\n"))
        assertFalse(crash.contains("prefs:"))
    }

    @Test fun flagsAreReadStrictly() {
        assertEquals(true, EngineConfig.flag("1"))
        assertEquals(false, EngineConfig.flag("off"))
        assertNull(EngineConfig.flag("maybe"))
        assertNull(EngineConfig.flag(null))
    }
}
