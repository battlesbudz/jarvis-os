package com.gameplan.daemon

import android.app.Service
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class UnifiedDaemonContractTest {

    @Test
    fun opHandlerRejectsUnknownOpType() {
        val context = ApplicationProvider.getApplicationContext<Context>()

        val result = OpHandler.handle(context, JSONObject().put("type", "not_a_real_op"))

        assertFalse(result.ok)
        assertEquals("Unknown op type: not_a_real_op", result.error)
    }

    @Test
    fun androidFileOpsRejectAppPrivateDataPaths() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val appDataDir = File(context.applicationInfo.dataDir ?: context.filesDir.path)
        val privateFile = File(appDataDir, "shared_prefs/jarvis_daemon.xml").path
        val privateDir = File(appDataDir, "shared_prefs").path
        val operations = listOf(
            JSONObject().put("type", "android_file_list").put("path", privateDir),
            JSONObject().put("type", "android_file_read").put("path", privateFile),
            JSONObject().put("type", "android_file_search").put("query", "jarvis").put("root", appDataDir.path),
            JSONObject().put("type", "android_open_file").put("path", privateFile),
            JSONObject().put("type", "android_copy_to_clipboard").put("path", privateFile),
        )

        for (op in operations) {
            val result = OpHandler.handle(context, op)

            assertFalse("${op.getString("type")} should reject private app paths", result.ok)
            assertTrue(
                "${op.getString("type")} returned unexpected error: ${result.error}",
                result.error?.contains("App-private file paths") == true
            )
        }
    }

    @Test
    fun androidReturnToJarvisDoesNotReportUnverifiedBackgroundLaunch() {
        val context = ApplicationProvider.getApplicationContext<Context>()

        val result = OpHandler.handle(context, JSONObject().put("type", "android_return_to_jarvis"))

        assertFalse(result.ok)
        assertTrue(
            "Unexpected return-to-Jarvis error: ${result.error}",
            result.error?.contains("verify") == true ||
                result.error?.contains("foreground") == true ||
                result.error?.contains("No browser found") == true
        )
    }

    @Test
    fun normalizeServerUrlAddsHttpsForBareHost() {
        assertEquals(
            "https://gameplanjarvisai.up.railway.app",
            JarvisConfig.normalizeServerUrl("gameplanjarvisai.up.railway.app")
        )
    }

    @Test
    fun reconnectStateKeysStayCompatibleWithStandaloneDaemon() {
        assertEquals("daemon_id", WebSocketService.EXTRA_DAEMON_ID)
        assertEquals("reconnect_secret", WebSocketService.EXTRA_RECONNECT_SECRET)
        assertEquals("daemon_id", WebSocketService.PREF_DAEMON_ID)
        assertEquals("reconnect_secret", WebSocketService.PREF_RECONNECT_SECRET)
    }

    @Test
    fun nativeBootstrapActionUsesInAppTokenInsteadOfVisiblePairCode() {
        assertEquals("com.gameplan.daemon.BOOTSTRAP", WebSocketService.ACTION_BOOTSTRAP)
        assertEquals("bootstrap_token", WebSocketService.EXTRA_BOOTSTRAP_TOKEN)
    }

    @Test
    fun localGemmaModelPathStoresUnderSafeModelDirectoryWhenManagerExists() {
        val managerClass = runCatching {
            Class.forName("com.gameplan.daemon.LocalGemmaModelManager")
        }.getOrNull() ?: return
        val context = ApplicationProvider.getApplicationContext<Context>()
        val modelId = "google/gemma 4:e2b-it"
        val method = managerClass.methods.firstOrNull { candidate ->
            candidate.returnType == File::class.java &&
                candidate.parameterTypes.toList() == listOf(Context::class.java, String::class.java)
        }

        assertTrue("LocalGemmaModelManager exposes a Context/String File path helper", method != null)

        val modelFile = method!!.invoke(null, context, modelId) as File
        val expectedSuffix = File(File(File(context.filesDir, "local_models"), "google_gemma_4_e2b-it"), "model.litertlm").path
        assertTrue(
            "Expected model file to end with $expectedSuffix, got ${modelFile.path}",
            modelFile.path.endsWith(expectedSuffix)
        )
    }

    @Test
    fun localGemmaStatusRequiresEngineValidationBeforeGenerationReady() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val modelFile = LocalGemmaModelManager.modelFile(context, "gemma-4-e4b-it")
        modelFile.parentFile?.mkdirs()
        modelFile.writeText("not a real litert model")

        try {
            val result = OpHandler.handle(
                context,
                JSONObject()
                    .put("type", "android_local_model_status")
                    .put("model", "gemma-4-e4b-it")
            )

            assertTrue(result.ok)
            val data = result.data as JSONObject
            assertTrue(data.getBoolean("modelFileReady"))
            assertFalse(data.getBoolean("generationReady"))
            assertTrue(data.getBoolean("needsEngineValidation"))
            assertFalse(data.getBoolean("engineValidated"))
        } finally {
            modelFile.parentFile?.deleteRecursively()
        }
    }

    @Test
    fun outsideAppVoiceSessionNotificationControlsStayStable() {
        val actions = OutsideAppVoiceSessionStateMachine.notificationActions()

        assertEquals(listOf("Pause", "Resume", "End", "Open"), actions.map { it.label })
        assertEquals(
            listOf(
                OutsideAppVoiceSessionService.ACTION_PAUSE,
                OutsideAppVoiceSessionService.ACTION_RESUME,
                OutsideAppVoiceSessionService.ACTION_END,
                OutsideAppVoiceSessionService.ACTION_OPEN,
            ),
            actions.map { it.action },
        )
    }

    @Test
    fun outsideAppVoiceOverlayTapInterruptsSpeechAndOpensControlsOtherwise() {
        assertEquals(
            OutsideAppVoiceOverlayTapAction.INTERRUPT_AND_LISTEN,
            OutsideAppVoiceSessionStateMachine.overlayTapAction(OutsideAppVoiceState.SPEAKING),
        )
        for (state in listOf(
            OutsideAppVoiceState.IDLE,
            OutsideAppVoiceState.LISTENING,
            OutsideAppVoiceState.WORKING,
            OutsideAppVoiceState.APPROVAL,
            OutsideAppVoiceState.PAUSED,
        )) {
            assertEquals(
                "Unexpected overlay tap action for $state",
                OutsideAppVoiceOverlayTapAction.OPEN_CONTROLS,
                OutsideAppVoiceSessionStateMachine.overlayTapAction(state),
            )
        }
    }

    @Test
    fun outsideAppVoiceServiceDoesNotAutoResumeFromNullRestart() {
        val controller = Robolectric.buildService(OutsideAppVoiceSessionService::class.java).create()
        val service = controller.get()

        val result = service.onStartCommand(null, 0, 1)

        assertEquals(Service.START_NOT_STICKY, result)
        assertFalse(service.sessionActiveForTest())
        assertEquals(OutsideAppVoiceState.IDLE, service.stateForTest())
        controller.destroy()
    }

    @Test
    fun outsideAppVoiceServiceTracksPauseResumeAndEnd() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val controller = Robolectric.buildService(OutsideAppVoiceSessionService::class.java).create()
        val service = controller.get()

        service.onStartCommand(OutsideAppVoiceSessionService.startIntent(context), 0, 1)
        assertTrue(service.sessionActiveForTest())
        assertEquals(OutsideAppVoiceState.LISTENING, service.stateForTest())
        assertTrue(OutsideAppVoiceSessionService.shouldAcceptPlaybackForCurrentSession())

        service.onStartCommand(
            OutsideAppVoiceSessionService.controlIntent(context, OutsideAppVoiceSessionService.ACTION_PAUSE),
            0,
            2,
        )
        assertEquals(OutsideAppVoiceState.PAUSED, service.stateForTest())
        assertFalse(OutsideAppVoiceSessionService.shouldAcceptPlaybackForCurrentSession())

        service.onStartCommand(OutsideAppVoiceSessionService.startIntent(context), 0, 3)
        assertEquals(OutsideAppVoiceState.PAUSED, service.stateForTest())
        assertFalse(OutsideAppVoiceSessionService.shouldAcceptPlaybackForCurrentSession())

        service.onStartCommand(
            OutsideAppVoiceSessionService.controlIntent(context, OutsideAppVoiceSessionService.ACTION_RESUME),
            0,
            4,
        )
        assertEquals(OutsideAppVoiceState.LISTENING, service.stateForTest())
        assertTrue(OutsideAppVoiceSessionService.shouldAcceptPlaybackForCurrentSession())

        service.onStartCommand(
            OutsideAppVoiceSessionService.controlIntent(context, OutsideAppVoiceSessionService.ACTION_END),
            0,
            5,
        )
        assertFalse(service.sessionActiveForTest())
        assertEquals(OutsideAppVoiceState.IDLE, service.stateForTest())
        assertFalse(OutsideAppVoiceSessionService.shouldAcceptPlaybackForCurrentSession())
        controller.destroy()
        assertFalse(OutsideAppVoiceSessionService.shouldAcceptPlaybackForCurrentSession())

        OutsideAppVoiceSessionService.clearEndedPlaybackGateForTalkModeEnable()
        assertTrue(OutsideAppVoiceSessionService.shouldAcceptPlaybackForCurrentSession())

        val restartedController = Robolectric.buildService(OutsideAppVoiceSessionService::class.java).create()
        val restartedService = restartedController.get()
        restartedService.onStartCommand(OutsideAppVoiceSessionService.startIntent(context), 0, 6)
        assertTrue(restartedService.sessionActiveForTest())
        assertEquals(OutsideAppVoiceState.LISTENING, restartedService.stateForTest())
        assertTrue(OutsideAppVoiceSessionService.shouldAcceptPlaybackForCurrentSession())
        restartedController.destroy()
    }
}
