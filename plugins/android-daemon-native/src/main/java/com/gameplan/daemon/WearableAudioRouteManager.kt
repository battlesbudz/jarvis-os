package com.gameplan.daemon

import android.annotation.TargetApi
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executor

internal data class WearableAudioDeviceCandidate(
    val id: Int,
    val type: Int,
    val name: String,
)

internal object WearableAudioRoutePolicy {
    private val preferredTypes = listOf(
        AudioDeviceInfo.TYPE_BLE_HEADSET,
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_HEARING_AID,
    )

    fun isWearableCommunicationType(type: Int): Boolean = type in preferredTypes

    fun select(
        candidates: List<WearableAudioDeviceCandidate>,
        allowHearingAid: Boolean = true,
    ): WearableAudioDeviceCandidate? {
        return preferredTypes.firstNotNullOfOrNull { preferredType ->
            if (!allowHearingAid && preferredType == AudioDeviceInfo.TYPE_HEARING_AID) {
                return@firstNotNullOfOrNull null
            }
            candidates.firstOrNull { it.type == preferredType }
        }
    }

    fun typeName(type: Int): String = when (type) {
        AudioDeviceInfo.TYPE_BLE_HEADSET -> "ble_headset"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth_sco"
        AudioDeviceInfo.TYPE_HEARING_AID -> "hearing_aid"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "phone_earpiece"
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "phone_speaker"
        AudioDeviceInfo.TYPE_BUILTIN_MIC -> "phone_microphone"
        else -> "android_audio_$type"
    }
}

internal data class WearableAudioRouteSnapshot(
    val supported: Boolean,
    val available: Boolean,
    val active: Boolean,
    val state: String,
    val deviceName: String?,
    val deviceType: String?,
    val lastError: String?,
) {
    val message: String
        get() = when {
            active -> "${deviceName ?: "Bluetooth wearable"} is the active Jarvis voice microphone and speaker route."
            lastError != null -> "Bluetooth wearable audio could not be activated: $lastError"
            available -> "${deviceName ?: "Bluetooth wearable"} is available and will activate when a Jarvis voice session starts."
            else -> "Pair and connect Bluetooth glasses or a headset to use them for Jarvis voice."
        }
}

/**
 * Owns the Android communication route used by Jarvis voice sessions.
 *
 * The manager intentionally uses AudioManager's already-connected communication
 * devices instead of scanning or opening a proprietary BLE/GATT connection. This
 * keeps the first wearable slice hardware-agnostic and avoids location/scan
 * permissions. Owners are reference-counted so Talk Mode and an in-app speech
 * turn cannot clear each other's route.
 */
internal object WearableAudioRouteManager {
    private const val ROUTE_CONFIRM_TIMEOUT_MS = 3_000L
    private const val ROUTE_RETRY_DELAY_MS = 500L
    private const val ROUTE_RETRY_MAX_DELAY_MS = 30_000L
    private const val LEGACY_SCO_TEARDOWN_TIMEOUT_MS = 1_500L
    private const val LEGACY_SCO_STALE_DISCONNECT_GRACE_MS = 1_500L

    private val mainHandler = Handler(Looper.getMainLooper())
    private val mainExecutor = Executor { command -> mainHandler.post(command) }
    private val owners = linkedSetOf<String>()
    private val pendingCallbacks = CopyOnWriteArrayList<(WearableAudioRouteSnapshot) -> Unit>()

    private var appContext: Context? = null
    private var audioManager: AudioManager? = null
    private var previousAudioMode: Int? = null
    private var requestedDeviceId: Int? = null
    private var routeGeneration = 0
    private var routeState = "idle"
    private var lastError: String? = null
    private var callbackRegistered = false
    private var scoReceiverRegistered = false
    private var communicationDeviceListenerRegistered = false
    private var routeRecoveryPending = false
    private var legacyScoTeardownPending = false
    private var legacyScoTeardownWaitElapsed = false
    private var legacyScoTeardownGeneration = 0
    private var routeRecoveryScheduled = false
    private var routeRetryAttempt = 0

    private val audioDeviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
            refreshAfterDeviceChange()
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
            refreshAfterDeviceChange()
        }
    }

    private val scoAudioStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED) return
            val state = intent.getIntExtra(
                AudioManager.EXTRA_SCO_AUDIO_STATE,
                AudioManager.SCO_AUDIO_STATE_ERROR,
            )
            runOnMain { handleLegacyScoState(state) }
        }
    }

    fun acquire(context: Context, owner: String, callback: (WearableAudioRouteSnapshot) -> Unit) {
        runOnMain {
            ensureInitialized(context)
            owners.add(owner)
            pendingCallbacks.add(callback)
            activateBestRoute()
        }
    }

    fun release(owner: String) {
        runOnMain {
            owners.remove(owner)
            if (owners.isEmpty()) clearRoute()
        }
    }

    fun snapshot(context: Context): WearableAudioRouteSnapshot {
        ensureInitialized(context)
        val manager = audioManager ?: return unsupportedSnapshot("Android AudioManager is unavailable.")
        val selected = currentSelectedDevice(manager)
        val available = bestAvailableDevice(manager)
        val ownsActiveRoute = owners.isNotEmpty() && routeState == "active"
        val activeWearable = ownsActiveRoute && (
            selected?.let { WearableAudioRoutePolicy.isWearableCommunicationType(it.type) } == true ||
                (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && available != null)
        )
        val displayDevice = if (activeWearable) selected ?: available else available
        return WearableAudioRouteSnapshot(
            supported = true,
            available = displayDevice != null,
            active = activeWearable,
            state = when {
                activeWearable -> "active"
                routeState == "requesting" -> "requesting"
                routeState == "failed" -> "failed"
                displayDevice != null -> "available"
                else -> "not_connected"
            },
            deviceName = displayDevice?.productName?.toString()?.takeIf { it.isNotBlank() },
            deviceType = displayDevice?.let { WearableAudioRoutePolicy.typeName(it.type) },
            lastError = lastError,
        )
    }

    private fun activateBestRoute() {
        val context = appContext ?: return completePending(unsupportedSnapshot("Android context is unavailable."))
        val manager = audioManager ?: return completePending(unsupportedSnapshot("Android AudioManager is unavailable."))
        if (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.S &&
            legacyScoTeardownPending &&
            !legacyScoTeardownWaitElapsed
        ) return
        val selected = currentSelectedDevice(manager)
        if (selected != null && WearableAudioRoutePolicy.isWearableCommunicationType(selected.type)) {
            routeState = "active"
            lastError = null
            finishRouteRecovery(success = true, "device=${selected.productName} type=${WearableAudioRoutePolicy.typeName(selected.type)}")
            completePending(snapshot(context))
            return
        }

        val device = bestAvailableDevice(manager)
        if (device == null) {
            routeState = "not_connected"
            lastError = null
            finishRouteRecovery(success = false, "no wearable communication device is available")
            completePending(snapshot(context))
            return
        }

        if (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.S &&
            routeState == "active" &&
            requestedDeviceId == device.id
        ) {
            lastError = null
            completePending(snapshot(context))
            return
        }

        if (routeState == "requesting" && requestedDeviceId == device.id) return

        if (previousAudioMode == null) previousAudioMode = manager.mode
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        requestedDeviceId = device.id
        val requestGeneration = ++routeGeneration
        routeState = "requesting"
        lastError = null

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val accepted = try {
                manager.setCommunicationDevice(device)
            } catch (error: Throwable) {
                lastError = error.message ?: error.javaClass.simpleName
                false
            }
            if (!accepted) {
                routeState = "failed"
                if (lastError == null) lastError = "Android rejected the communication route request."
                routeRecoveryPending = true
                DaemonLog.add(
                    "wearable_audio: communication route request rejected; ${lastError ?: "unknown error"}; retry scheduled",
                )
                completePending(snapshot(context))
                scheduleRouteRecovery(expectLegacy = false)
                return
            }
            waitForRouteConfirmation(device.id, requestGeneration)
        } else {
            @Suppress("DEPRECATION")
            try {
                manager.startBluetoothSco()
                manager.isBluetoothScoOn = true
                waitForLegacyScoConfirmation(requestGeneration)
            } catch (error: Throwable) {
                routeState = "failed"
                lastError = error.message ?: error.javaClass.simpleName
                routeRecoveryPending = true
                DaemonLog.add("wearable_audio: legacy SCO startup failed; ${lastError ?: "unknown error"}; retry scheduled")
                completePending(snapshot(context))
                scheduleRouteRecovery(expectLegacy = true)
            }
        }
    }

    private fun waitForRouteConfirmation(deviceId: Int, requestGeneration: Int) {
        val context = appContext ?: return
        val check = object : Runnable {
            private val deadline = System.currentTimeMillis() + ROUTE_CONFIRM_TIMEOUT_MS

            override fun run() {
                if (requestGeneration != routeGeneration || owners.isEmpty()) return
                val manager = audioManager ?: return completePending(unsupportedSnapshot("Android AudioManager is unavailable."))
                val activeDevice = currentSelectedDevice(manager)
                if (activeDevice?.id == deviceId) {
                    routeState = "active"
                    lastError = null
                    finishRouteRecovery(
                        success = true,
                        "device=${activeDevice.productName} type=${WearableAudioRoutePolicy.typeName(activeDevice.type)}",
                    )
                    completePending(snapshot(context))
                    return
                }
                if (System.currentTimeMillis() >= deadline) {
                    routeState = "failed"
                    lastError = "Android did not confirm the Bluetooth audio route within ${ROUTE_CONFIRM_TIMEOUT_MS / 1_000} seconds."
                    routeRecoveryPending = true
                    DaemonLog.add("wearable_audio: communication route confirmation timed out; retry scheduled")
                    completePending(snapshot(context))
                    scheduleRouteRecovery(expectLegacy = false)
                    return
                }
                mainHandler.postDelayed(this, 100L)
            }
        }
        mainHandler.post(check)
    }

    private fun waitForLegacyScoConfirmation(requestGeneration: Int) {
        mainHandler.postDelayed({
            if (requestGeneration != routeGeneration || owners.isEmpty() || routeState != "requesting") {
                return@postDelayed
            }
            val error = "Android did not connect Bluetooth SCO within ${ROUTE_CONFIRM_TIMEOUT_MS / 1_000} seconds."
            routeRecoveryPending = true
            DaemonLog.add("wearable_audio: legacy SCO confirmation timed out; retry scheduled")
            failLegacyScoRequest(error)
            waitForLegacyScoTeardown(teardownSettled = false)
        }, ROUTE_CONFIRM_TIMEOUT_MS)
    }

    private fun handleLegacyScoState(state: Int) {
        if (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.S &&
            state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED &&
            legacyScoTeardownPending
        ) {
            @Suppress("DEPRECATION")
            val replacementStillRouted =
                legacyScoTeardownWaitElapsed &&
                    (routeState == "requesting" || routeState == "active") &&
                    audioManager?.isBluetoothScoOn == true
            legacyScoTeardownPending = false
            legacyScoTeardownWaitElapsed = false
            legacyScoTeardownGeneration += 1
            if (replacementStillRouted) {
                DaemonLog.add(
                    "wearable_audio: ignored stale legacy SCO teardown after replacement connected",
                )
                return
            }
            if (routeState != "requesting" && routeState != "active") {
                continueAfterLegacyScoTeardown()
                return
            }
        }
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ||
            (routeState != "requesting" && routeState != "active")
        ) return
        val context = appContext ?: return
        when (state) {
            AudioManager.SCO_AUDIO_STATE_CONNECTED -> {
                if (routeState != "requesting") return
                preserveLegacyScoTeardownGuardAfterConnection()
                routeState = "active"
                lastError = null
                finishRouteRecovery(success = true, "Bluetooth SCO connected for deviceId=$requestedDeviceId")
                completePending(snapshot(context))
            }
            AudioManager.SCO_AUDIO_STATE_ERROR -> {
                handleLegacyScoTerminalState(
                    "Android reported a Bluetooth SCO routing error.",
                    teardownSettled = false,
                )
            }
            AudioManager.SCO_AUDIO_STATE_DISCONNECTED -> {
                val error = if (routeState == "active") {
                    "Bluetooth SCO disconnected during the active Jarvis voice route."
                } else {
                    "Bluetooth SCO disconnected before the voice route was ready."
                }
                handleLegacyScoTerminalState(error, teardownSettled = true)
            }
        }
    }

    private fun handleLegacyScoTerminalState(error: String, teardownSettled: Boolean) {
        val shouldRetry = owners.isNotEmpty()
        if (shouldRetry) {
            routeRecoveryPending = true
            DaemonLog.add("wearable_audio: legacy SCO route lost; $error; retry scheduled")
        }
        failLegacyScoRequest(error)
        if (!shouldRetry) return
        waitForLegacyScoTeardown(teardownSettled)
    }

    private fun waitForLegacyScoTeardown(teardownSettled: Boolean) {
        if (teardownSettled) {
            legacyScoTeardownPending = false
            legacyScoTeardownWaitElapsed = false
            legacyScoTeardownGeneration += 1
            scheduleRouteRecovery(expectLegacy = true)
            return
        }
        beginLegacyScoTeardownWait()
    }

    private fun beginLegacyScoTeardownWait() {
        legacyScoTeardownPending = true
        legacyScoTeardownWaitElapsed = false
        val teardownGeneration = ++legacyScoTeardownGeneration
        mainHandler.postDelayed({
            if (
                teardownGeneration != legacyScoTeardownGeneration ||
                !legacyScoTeardownPending
            ) return@postDelayed
            legacyScoTeardownWaitElapsed = true
            DaemonLog.add(
                "wearable_audio: legacy SCO teardown confirmation timed out; retry continuing",
            )
            // Keep legacyScoTeardownPending set so a late DISCONNECTED broadcast is
            // consumed instead of being mistaken for failure of the new request.
            continueAfterLegacyScoTeardown()
        }, LEGACY_SCO_TEARDOWN_TIMEOUT_MS)
    }

    private fun continueAfterLegacyScoTeardown() {
        if (owners.isEmpty()) return
        if (routeRecoveryPending && routeState == "failed") {
            scheduleRouteRecovery(expectLegacy = true)
        } else {
            activateBestRoute()
        }
    }

    private fun preserveLegacyScoTeardownGuardAfterConnection() {
        if (!legacyScoTeardownPending || !legacyScoTeardownWaitElapsed) {
            legacyScoTeardownPending = false
            legacyScoTeardownWaitElapsed = false
            legacyScoTeardownGeneration += 1
            return
        }
        val guardGeneration = legacyScoTeardownGeneration
        mainHandler.postDelayed({
            if (
                guardGeneration != legacyScoTeardownGeneration ||
                !legacyScoTeardownPending ||
                !legacyScoTeardownWaitElapsed
            ) return@postDelayed
            legacyScoTeardownPending = false
            legacyScoTeardownWaitElapsed = false
            legacyScoTeardownGeneration += 1
            DaemonLog.add(
                "wearable_audio: legacy SCO stale teardown guard expired after replacement connected",
            )
        }, LEGACY_SCO_STALE_DISCONNECT_GRACE_MS)
    }

    private fun handleCommunicationDeviceChanged(device: AudioDeviceInfo?) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || owners.isEmpty()) return
        if (device != null && WearableAudioRoutePolicy.isWearableCommunicationType(device.type)) {
            requestedDeviceId = device.id
            routeState = "active"
            lastError = null
            finishRouteRecovery(success = true, "device=${device.productName} type=${WearableAudioRoutePolicy.typeName(device.type)}")
            appContext?.let { completePending(snapshot(it)) }
            return
        }
        if (routeState != "active") return
        routeGeneration += 1
        routeState = "failed"
        lastError = "Android switched the active communication route away from the Bluetooth wearable."
        routeRecoveryPending = true
        DaemonLog.add(
            "wearable_audio: communication route lost; active=${device?.productName ?: "none"} " +
                "type=${device?.let { WearableAudioRoutePolicy.typeName(it.type) } ?: "none"}; retry scheduled",
        )
        appContext?.let { completePending(snapshot(it)) }
        scheduleRouteRecovery(expectLegacy = false)
    }

    private fun finishRouteRecovery(success: Boolean, detail: String) {
        if (!routeRecoveryPending) return
        routeRecoveryPending = false
        routeRetryAttempt = 0
        val outcome = if (success) "succeeded" else "failed"
        DaemonLog.add("wearable_audio: route recovery $outcome; $detail")
    }

    private fun scheduleRouteRecovery(expectLegacy: Boolean) {
        if (routeRecoveryScheduled) return
        routeRecoveryScheduled = true
        val retryDelayMs = minOf(
            ROUTE_RETRY_MAX_DELAY_MS,
            ROUTE_RETRY_DELAY_MS * (1L shl routeRetryAttempt.coerceAtMost(6)),
        )
        routeRetryAttempt += 1
        mainHandler.postDelayed({
            routeRecoveryScheduled = false
            if (
                owners.isNotEmpty() &&
                routeState == "failed" &&
                (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) == expectLegacy
            ) {
                activateBestRoute()
            }
        }, retryDelayMs)
    }

    private fun failLegacyScoRequest(error: String) {
        val context = appContext ?: return
        val manager = audioManager
        routeState = "failed"
        lastError = error
        try {
            @Suppress("DEPRECATION")
            manager?.stopBluetoothSco()
            @Suppress("DEPRECATION")
            manager?.isBluetoothScoOn = false
        } catch (_: Throwable) {
            // Keep the original routing failure as the actionable diagnostic.
        }
        completePending(snapshot(context))
    }

    private fun clearRoute() {
        val manager = audioManager ?: return
        val waitForLegacyTeardown =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.S &&
                (routeState == "active" || routeState == "requesting")
        if (waitForLegacyTeardown) beginLegacyScoTeardownWait()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                manager.clearCommunicationDevice()
            } else {
                @Suppress("DEPRECATION")
                manager.stopBluetoothSco()
                @Suppress("DEPRECATION")
                manager.isBluetoothScoOn = false
            }
        } catch (error: Throwable) {
            lastError = error.message ?: error.javaClass.simpleName
        } finally {
            if (routeRecoveryPending) {
                routeRecoveryPending = false
                DaemonLog.add("wearable_audio: route recovery cancelled; voice session ended")
            }
            routeRecoveryScheduled = false
            routeRetryAttempt = 0
            previousAudioMode?.let { previousMode ->
                if (manager.mode == AudioManager.MODE_IN_COMMUNICATION) {
                    manager.mode = previousMode
                }
            }
            previousAudioMode = null
            requestedDeviceId = null
            routeGeneration += 1
            routeState = "idle"
            pendingCallbacks.clear()
        }
    }

    private fun refreshAfterDeviceChange() {
        runOnMain {
            if (owners.isEmpty()) return@runOnMain
            val manager = audioManager ?: return@runOnMain
            val active = currentSelectedDevice(manager)
            if (active == null || !WearableAudioRoutePolicy.isWearableCommunicationType(active.type)) {
                activateBestRoute()
            }
        }
    }

    private fun ensureInitialized(context: Context) {
        val applicationContext = context.applicationContext
        if (audioManager == null) {
            appContext = applicationContext
            audioManager = applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        }
        if (!callbackRegistered) {
            audioManager?.registerAudioDeviceCallback(audioDeviceCallback, mainHandler)
            callbackRegistered = true
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && !scoReceiverRegistered) {
            val filter = IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
            @Suppress("DEPRECATION")
            applicationContext.registerReceiver(scoAudioStateReceiver, filter)
            scoReceiverRegistered = true
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !communicationDeviceListenerRegistered) {
            audioManager?.let { manager ->
                Api31CommunicationDeviceMonitor.register(manager, mainExecutor) { device ->
                    runOnMain { handleCommunicationDeviceChanged(device) }
                }
                communicationDeviceListenerRegistered = true
            }
        }
    }

    private fun bestAvailableDevice(manager: AudioManager): AudioDeviceInfo? {
        val devices = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            manager.availableCommunicationDevices
        } else {
            manager.getDevices(AudioManager.GET_DEVICES_ALL).toList()
        }
        val candidates = devices.map {
            WearableAudioDeviceCandidate(
                id = it.id,
                type = it.type,
                name = it.productName?.toString().orEmpty(),
            )
        }
        val selected = WearableAudioRoutePolicy.select(
            candidates,
            allowHearingAid = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S,
        ) ?: return null
        return devices.firstOrNull { it.id == selected.id }
    }

    private fun currentSelectedDevice(manager: AudioManager): AudioDeviceInfo? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
        return manager.communicationDevice
    }

    private fun completePending(snapshot: WearableAudioRouteSnapshot) {
        val callbacks = pendingCallbacks.toList()
        pendingCallbacks.clear()
        callbacks.forEach { callback -> callback(snapshot) }
    }

    private fun unsupportedSnapshot(error: String) = WearableAudioRouteSnapshot(
        supported = false,
        available = false,
        active = false,
        state = "unsupported",
        deviceName = null,
        deviceType = null,
        lastError = error,
    )

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
    }

    @TargetApi(Build.VERSION_CODES.S)
    private object Api31CommunicationDeviceMonitor {
        private var listener: AudioManager.OnCommunicationDeviceChangedListener? = null

        fun register(
            manager: AudioManager,
            executor: Executor,
            onChanged: (AudioDeviceInfo?) -> Unit,
        ) {
            if (listener != null) return
            val newListener = AudioManager.OnCommunicationDeviceChangedListener(onChanged)
            manager.addOnCommunicationDeviceChangedListener(executor, newListener)
            listener = newListener
        }
    }
}
