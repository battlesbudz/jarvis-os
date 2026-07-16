package com.gameplan.daemon

import android.app.Application
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
import org.robolectric.Shadows.shadowOf
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

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
    fun phoneGemmaMemoryAdmissionRetriesReportedSafetyReserveSnapshot() {
        val mib = 1024L * 1024L
        val reported = LocalGemmaMemoryAdmissionPolicy.evaluate(
            availableBytes = 1670L * mib,
            lowMemory = false,
            backendName = "gpu",
        )

        assertFalse(reported.allowed)
        assertEquals(LocalGemmaMemoryBlockReason.JARVIS_SAFETY_RESERVE, reported.blockReason)
        assertEquals(1800L * mib, reported.minimumBytes)
        assertEquals(130L * mib, reported.shortfallBytes)
        assertTrue(LocalGemmaMemoryAdmissionPolicy.shouldAttemptRecovery(reported))

        val recovered = LocalGemmaMemoryAdmissionPolicy.evaluate(
            availableBytes = 1840L * mib,
            lowMemory = false,
            backendName = "gpu",
        )
        assertTrue(recovered.allowed)
        assertEquals(null, recovered.blockReason)
    }

    @Test
    fun phoneGemmaMemoryAdmissionDoesNotWaitWhenAndroidReportsLowMemory() {
        val mib = 1024L * 1024L
        val reported = LocalGemmaMemoryAdmissionPolicy.evaluate(
            availableBytes = 1670L * mib,
            lowMemory = true,
            backendName = "gpu",
        )

        assertFalse(reported.allowed)
        assertEquals(LocalGemmaMemoryBlockReason.ANDROID_LOW_MEMORY, reported.blockReason)
        assertFalse(LocalGemmaMemoryAdmissionPolicy.shouldAttemptRecovery(reported))
    }

    @Test
    fun phoneGemmaOperationAdmissionSerializesGenerationAndValidationBeforeWakePause() {
        val admission = LocalGemmaOperationAdmission()
        val executor = Executors.newFixedThreadPool(2)
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val requestIds = listOf("request-a", "request-b")

        try {
            val futures = requestIds.map { requestId ->
                executor.submit<LocalGemmaGenerationAdmissionResult> {
                    ready.countDown()
                    start.await()
                    admission.tryAcquireGeneration(requestId)
                }
            }
            assertTrue("Concurrent admission workers did not become ready", ready.await(1, TimeUnit.SECONDS))
            start.countDown()
            val results = futures.map { it.get(1, TimeUnit.SECONDS) }

            assertEquals(1, results.count { it == LocalGemmaGenerationAdmissionResult.ACQUIRED })
            assertEquals(1, results.count { it == LocalGemmaGenerationAdmissionResult.BUSY })
            val acquiredRequestId = requestIds[results.indexOf(LocalGemmaGenerationAdmissionResult.ACQUIRED)]
            assertFalse(admission.tryAcquireValidation())
            admission.releaseGeneration(acquiredRequestId)

            assertTrue(admission.tryAcquireValidation())
            assertEquals(
                LocalGemmaGenerationAdmissionResult.BUSY,
                admission.tryAcquireGeneration("request-c"),
            )
            assertFalse(admission.tryAcquireValidation())
            admission.releaseValidation()
            assertEquals(
                LocalGemmaGenerationAdmissionResult.ACQUIRED,
                admission.tryAcquireGeneration("request-c"),
            )
            assertEquals(
                LocalGemmaGenerationAdmissionResult.DUPLICATE,
                admission.tryAcquireGeneration("request-c"),
            )
            admission.releaseGeneration("request-c")
            assertFalse(admission.hasActiveOperation())
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun phoneGemmaOperationAdmissionBlocksStartsDuringMaintenanceAndShutdown() {
        val admission = LocalGemmaOperationAdmission()
        val executor = Executors.newSingleThreadExecutor()

        try {
            assertEquals(
                LocalGemmaGenerationAdmissionResult.ACQUIRED,
                admission.tryAcquireGeneration("request-active"),
            )
            assertTrue(admission.beginShutdown())
            assertFalse(admission.beginShutdown())
            assertEquals(
                LocalGemmaGenerationAdmissionResult.BUSY,
                admission.tryAcquireGeneration("request-blocked"),
            )
            assertFalse(admission.tryAcquireValidation())
            assertFalse(admission.tryAcquireMaintenance())

            val shutdownWaitFinished = CountDownLatch(1)
            val shutdownDrained = executor.submit<Boolean> {
                try {
                    admission.awaitShutdownDrain()
                    true
                } finally {
                    shutdownWaitFinished.countDown()
                }
            }
            assertFalse(shutdownWaitFinished.await(100, TimeUnit.MILLISECONDS))
            admission.releaseGeneration("request-active")
            assertTrue(shutdownWaitFinished.await(1, TimeUnit.SECONDS))
            assertTrue(shutdownDrained.get(1, TimeUnit.SECONDS))
            assertEquals(
                LocalGemmaGenerationAdmissionResult.BUSY,
                admission.tryAcquireGeneration("request-still-blocked"),
            )
            admission.endShutdown()
            assertFalse(admission.hasActiveOperation())

            assertTrue(admission.tryAcquireMaintenance())
            assertFalse(admission.tryAcquireMaintenance())
            assertEquals(
                LocalGemmaGenerationAdmissionResult.BUSY,
                admission.tryAcquireGeneration("request-during-maintenance"),
            )
            assertFalse(admission.tryAcquireValidation())
            admission.releaseMaintenance()
            assertFalse(admission.hasActiveOperation())
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun localInferenceRecoveryHonorsCurrentCaptureAndTalkModeState() {
        assertEquals(
            WakeWordLocalInferenceRecoveryAction.ORDINARY_SCAN,
            WakeWordLocalInferencePolicy.recoveryAction(
                captureWasRequested = true,
                captureCurrentlyRequested = true,
                talkModeEnabled = false,
            ),
        )
        assertEquals(
            WakeWordLocalInferenceRecoveryAction.TALK_MODE,
            WakeWordLocalInferencePolicy.recoveryAction(
                captureWasRequested = true,
                captureCurrentlyRequested = true,
                talkModeEnabled = true,
            ),
        )
        assertEquals(
            WakeWordLocalInferenceRecoveryAction.NONE,
            WakeWordLocalInferencePolicy.recoveryAction(
                captureWasRequested = true,
                captureCurrentlyRequested = false,
                talkModeEnabled = false,
            ),
        )
        assertEquals(
            WakeWordLocalInferenceRecoveryAction.NONE,
            WakeWordLocalInferencePolicy.recoveryAction(
                captureWasRequested = false,
                captureCurrentlyRequested = true,
                talkModeEnabled = true,
            ),
        )
    }

    @Test
    fun talkModeRecoveryOnlyRearmsAfterSessionReturnsToListening() {
        assertTrue(
            OutsideAppVoiceSessionStateMachine.shouldRecoverTalkModeAfterLocalInference(
                OutsideAppVoiceState.LISTENING,
            ),
        )
        for (state in listOf(
            OutsideAppVoiceState.IDLE,
            OutsideAppVoiceState.WORKING,
            OutsideAppVoiceState.SPEAKING,
            OutsideAppVoiceState.APPROVAL,
            OutsideAppVoiceState.PAUSED,
        )) {
            assertFalse(
                "Talk Mode must stay paused while the session is $state",
                OutsideAppVoiceSessionStateMachine.shouldRecoverTalkModeAfterLocalInference(state),
            )
        }
    }

    @Test
    fun wakeCaptureResumesWhenWorkingOrApprovalReturnsToListening() {
        for (previousState in listOf(OutsideAppVoiceState.WORKING, OutsideAppVoiceState.APPROVAL)) {
            assertTrue(
                OutsideAppVoiceSessionStateMachine.shouldResumeWakeCapture(
                    previousState,
                    OutsideAppVoiceState.LISTENING,
                ),
            )
        }
        for (previousState in listOf(
            OutsideAppVoiceState.IDLE,
            OutsideAppVoiceState.LISTENING,
            OutsideAppVoiceState.SPEAKING,
            OutsideAppVoiceState.PAUSED,
        )) {
            assertFalse(
                "Unexpected automatic wake resume from $previousState",
                OutsideAppVoiceSessionStateMachine.shouldResumeWakeCapture(
                    previousState,
                    OutsideAppVoiceState.LISTENING,
                ),
            )
        }
        assertFalse(
            OutsideAppVoiceSessionStateMachine.shouldResumeWakeCapture(
                OutsideAppVoiceState.APPROVAL,
                OutsideAppVoiceState.WORKING,
            ),
        )
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

    @Test
    fun outsideAppVoiceUnexpectedDestroyRecordsCrashAndBlocksPlayback() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val controller = Robolectric.buildService(OutsideAppVoiceSessionService::class.java).create()
        val service = controller.get()

        service.onStartCommand(OutsideAppVoiceSessionService.startIntent(context), 0, 1)
        assertTrue(service.sessionActiveForTest())
        assertEquals(OutsideAppVoiceState.LISTENING, service.stateForTest())

        controller.destroy()

        assertFalse(OutsideAppVoiceSessionService.isActive())
        assertFalse(OutsideAppVoiceSessionService.shouldAcceptPlaybackForCurrentSession())
        assertTrue(DaemonLog.getAll().any { it.contains("voice_session: crash state=listening") })
    }

    @Test
    fun outsideAppVoiceRestartResetsExpectedStopBeforeUnexpectedDestroy() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val controller = Robolectric.buildService(OutsideAppVoiceSessionService::class.java).create()
        val service = controller.get()

        service.onStartCommand(OutsideAppVoiceSessionService.startIntent(context), 0, 1)
        service.onStartCommand(
            OutsideAppVoiceSessionService.controlIntent(context, OutsideAppVoiceSessionService.ACTION_END),
            0,
            2,
        )
        val crashCountBeforeRestart = DaemonLog.getAll().count { it.contains("voice_session: crash state=listening") }

        service.onStartCommand(OutsideAppVoiceSessionService.startIntent(context), 0, 3)
        assertTrue(service.sessionActiveForTest())
        assertEquals(OutsideAppVoiceState.LISTENING, service.stateForTest())

        controller.destroy()

        val crashCountAfterRestart = DaemonLog.getAll().count { it.contains("voice_session: crash state=listening") }
        assertTrue(crashCountAfterRestart > crashCountBeforeRestart)
    }

    @Test
    fun outsideAppVoiceStartPreservesActiveNonIdleState() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val controller = Robolectric.buildService(OutsideAppVoiceSessionService::class.java).create()
        val service = controller.get()

        service.onStartCommand(
            OutsideAppVoiceSessionService.setStateIntent(context, OutsideAppVoiceState.SPEAKING),
            0,
            1,
        )
        service.onStartCommand(OutsideAppVoiceSessionService.startIntent(context), 0, 2)

        assertTrue(service.sessionActiveForTest())
        assertEquals(OutsideAppVoiceState.SPEAKING, service.stateForTest())
        assertTrue(OutsideAppVoiceSessionService.shouldAcceptPlaybackForCurrentSession())
        controller.destroy()
    }

    @Test
    fun talkModeEnableStartsOutsideAppVoiceControls() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val shadowApplication = shadowOf(context as Application)
        shadowApplication.clearStartedServices()

        val result = OpHandler.handle(
            context,
            JSONObject()
                .put("type", "voice_set_talk_mode")
                .put("enabled", true)
        )

        assertTrue(result.ok)
        assertTrue(
            "Expected Talk Mode enable to start outside-app voice controls",
            shadowApplication.allStartedServices.any { intent ->
                intent.action == OutsideAppVoiceSessionService.ACTION_START &&
                    intent.component?.className == OutsideAppVoiceSessionService::class.java.name
            }
        )
    }

    @Test
    fun talkModeWakeSettingsStartControlsEvenWithoutSoftwareWakeWordFallback() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val shadowApplication = shadowOf(context as Application)
        shadowApplication.clearStartedServices()

        val result = OpHandler.handle(
            context,
            JSONObject()
                .put("type", "voice_set_wake_words")
                .put("enabled", false)
                .put("talkMode", true)
        )

        assertTrue(result.ok)
        assertTrue(
            "Expected Talk Mode wake settings to start outside-app voice controls",
            shadowApplication.allStartedServices.any { intent ->
                intent.action == OutsideAppVoiceSessionService.ACTION_START &&
                    intent.component?.className == OutsideAppVoiceSessionService::class.java.name
            }
        )
        assertFalse(
            "Talk Mode-only wake settings must not end outside-app voice controls",
            shadowApplication.allStartedServices.any { intent ->
                intent.action == OutsideAppVoiceSessionService.ACTION_END &&
                    intent.component?.className == OutsideAppVoiceSessionService::class.java.name
            }
        )
    }

    @Test
    fun talkModeDisableEndsOutsideAppVoiceControls() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val shadowApplication = shadowOf(context as Application)
        val controller = Robolectric.buildService(OutsideAppVoiceSessionService::class.java).create()
        val service = controller.get()
        service.onStartCommand(OutsideAppVoiceSessionService.startIntent(context), 0, 1)
        shadowApplication.clearStartedServices()

        val result = OpHandler.handle(
            context,
            JSONObject()
                .put("type", "voice_set_talk_mode")
                .put("enabled", false)
        )

        assertTrue(result.ok)
        assertTrue(
            "Expected Talk Mode disable to end outside-app voice controls",
            shadowApplication.allStartedServices.any { intent ->
                intent.action == OutsideAppVoiceSessionService.ACTION_END &&
                    intent.component?.className == OutsideAppVoiceSessionService::class.java.name
            }
        )
        controller.destroy()
    }

    @Test
    fun outsideAppVoiceServiceShowsApprovalPromptAndHandlesOverlayChoice() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val controller = Robolectric.buildService(OutsideAppVoiceSessionService::class.java).create()
        val service = controller.get()

        service.onStartCommand(
            OutsideAppVoiceSessionService.setApprovalIntent(
                context,
                "Approve sending this email to test@example.com?",
                "confirm-token-1",
            ),
            0,
            1,
        )

        assertTrue(service.sessionActiveForTest())
        assertEquals(OutsideAppVoiceState.APPROVAL, service.stateForTest())
        assertEquals(
            "Approve sending this email to test@example.com?",
            OutsideAppVoiceSessionService.currentApprovalPrompt(),
        )
        assertEquals("confirm-token-1", OutsideAppVoiceSessionService.currentApprovalToken())

        service.onOverlayDeny()
        assertEquals(OutsideAppVoiceState.LISTENING, service.stateForTest())
        assertEquals("", OutsideAppVoiceSessionService.currentApprovalPrompt())
        assertEquals("", OutsideAppVoiceSessionService.currentApprovalToken())

        service.onStartCommand(
            OutsideAppVoiceSessionService.setApprovalIntent(context, "Approve this action?", "confirm-token-2"),
            0,
            2,
        )
        service.onOverlayApprove()
        assertEquals(OutsideAppVoiceState.WORKING, service.stateForTest())
        assertEquals("", OutsideAppVoiceSessionService.currentApprovalPrompt())
        assertEquals("", OutsideAppVoiceSessionService.currentApprovalToken())
        controller.destroy()
    }
}
