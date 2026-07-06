package com.gameplan.daemon

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import com.gameplan.MainActivity
import org.json.JSONObject
import java.util.Locale

enum class OutsideAppVoiceState(val wireName: String) {
    IDLE("idle"),
    LISTENING("listening"),
    SPEAKING("speaking"),
    WORKING("working"),
    APPROVAL("approval"),
    PAUSED("paused");

    companion object {
        fun fromWireName(value: String?): OutsideAppVoiceState {
            val normalized = value?.trim()?.lowercase(Locale.US)
            return values().firstOrNull { it.wireName == normalized } ?: IDLE
        }
    }
}

enum class OutsideAppVoiceOverlayTapAction {
    INTERRUPT_AND_LISTEN,
    OPEN_CONTROLS,
}

data class OutsideAppVoiceNotificationAction(
    val label: String,
    val action: String,
)

object OutsideAppVoiceSessionStateMachine {
    fun overlayTapAction(state: OutsideAppVoiceState): OutsideAppVoiceOverlayTapAction {
        return if (state == OutsideAppVoiceState.SPEAKING) {
            OutsideAppVoiceOverlayTapAction.INTERRUPT_AND_LISTEN
        } else {
            OutsideAppVoiceOverlayTapAction.OPEN_CONTROLS
        }
    }

    fun notificationText(state: OutsideAppVoiceState): String {
        return when (state) {
            OutsideAppVoiceState.IDLE -> "Jarvis voice is ready"
            OutsideAppVoiceState.LISTENING -> "Listening"
            OutsideAppVoiceState.SPEAKING -> "Speaking"
            OutsideAppVoiceState.WORKING -> "Working"
            OutsideAppVoiceState.APPROVAL -> "Waiting for your approval"
            OutsideAppVoiceState.PAUSED -> "Paused"
        }
    }

    fun notificationActions(): List<OutsideAppVoiceNotificationAction> {
        return listOf(
            OutsideAppVoiceNotificationAction("Pause", OutsideAppVoiceSessionService.ACTION_PAUSE),
            OutsideAppVoiceNotificationAction("Resume", OutsideAppVoiceSessionService.ACTION_RESUME),
            OutsideAppVoiceNotificationAction("End", OutsideAppVoiceSessionService.ACTION_END),
            OutsideAppVoiceNotificationAction("Open", OutsideAppVoiceSessionService.ACTION_OPEN),
        )
    }
}

class OutsideAppVoiceSessionService : Service() {
    companion object {
        private const val CHANNEL_ID = "jarvis_voice_session"
        private const val NOTIFICATION_ID = 1003
        const val ACTION_START = "com.gameplan.daemon.VOICE_SESSION_START"
        const val ACTION_PAUSE = "com.gameplan.daemon.VOICE_SESSION_PAUSE"
        const val ACTION_RESUME = "com.gameplan.daemon.VOICE_SESSION_RESUME"
        const val ACTION_END = "com.gameplan.daemon.VOICE_SESSION_END"
        const val ACTION_OPEN = "com.gameplan.daemon.VOICE_SESSION_OPEN"
        const val ACTION_SET_STATE = "com.gameplan.daemon.VOICE_SESSION_SET_STATE"
        const val ACTION_SET_APPROVAL = "com.gameplan.daemon.VOICE_SESSION_SET_APPROVAL"
        const val ACTION_APPROVE = "com.gameplan.daemon.VOICE_SESSION_APPROVE"
        const val ACTION_DENY = "com.gameplan.daemon.VOICE_SESSION_DENY"
        const val ACTION_E2E_SIMULATE_CRASH = "com.gameplan.daemon.VOICE_SESSION_E2E_SIMULATE_CRASH"
        const val EXTRA_STATE = "state"
        const val EXTRA_APPROVAL_PROMPT = "approval_prompt"
        const val EXTRA_APPROVAL_TOKEN = "approval_token"

        @Volatile var instance: OutsideAppVoiceSessionService? = null
            private set

        @Volatile private var endedSessionBlocksPlayback = false

        fun isActive(): Boolean = instance?.sessionActive == true

        fun currentState(): OutsideAppVoiceState = instance?.state ?: OutsideAppVoiceState.IDLE

        fun clearEndedPlaybackGateForTalkModeEnable() {
            endedSessionBlocksPlayback = false
        }

        fun shouldAcceptPlaybackForCurrentSession(): Boolean {
            val service = instance
            if (service == null) {
                return !endedSessionBlocksPlayback
            }
            return service.sessionActive &&
                service.state != OutsideAppVoiceState.PAUSED &&
                service.state != OutsideAppVoiceState.IDLE
        }

        fun markPlaybackSpeaking() {
            instance?.setStateFromAnyThread(OutsideAppVoiceState.SPEAKING)
        }

        fun markPlaybackListening() {
            instance?.setStateFromAnyThread(OutsideAppVoiceState.LISTENING)
        }

        fun currentApprovalPrompt(): String = instance?.approvalPrompt ?: ""

        fun currentApprovalToken(): String = instance?.approvalToken ?: ""

        fun startIntent(context: Context): Intent {
            return Intent(context, OutsideAppVoiceSessionService::class.java).apply {
                action = ACTION_START
            }
        }

        fun controlIntent(context: Context, actionName: String): Intent {
            return Intent(context, OutsideAppVoiceSessionService::class.java).apply {
                action = actionName
            }
        }

        fun setStateIntent(context: Context, state: OutsideAppVoiceState): Intent {
            return Intent(context, OutsideAppVoiceSessionService::class.java).apply {
                action = ACTION_SET_STATE
                putExtra(EXTRA_STATE, state.wireName)
            }
        }

        fun setApprovalIntent(context: Context, prompt: String, confirmationToken: String? = null): Intent {
            return Intent(context, OutsideAppVoiceSessionService::class.java).apply {
                action = ACTION_SET_APPROVAL
                putExtra(EXTRA_APPROVAL_PROMPT, prompt)
                putExtra(EXTRA_APPROVAL_TOKEN, confirmationToken ?: "")
            }
        }

        fun e2eCrashIntent(context: Context): Intent {
            return Intent(context, OutsideAppVoiceSessionService::class.java).apply {
                action = ACTION_E2E_SIMULATE_CRASH
            }
        }
    }

    private val overlayController by lazy { OutsideAppVoiceOverlayController(this) }
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var state: OutsideAppVoiceState = OutsideAppVoiceState.IDLE
    @Volatile private var sessionActive = false
    @Volatile private var approvalPrompt = ""
    @Volatile private var approvalToken = ""
    @Volatile private var expectedStop = false

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                expectedStop = false
                endedSessionBlocksPlayback = false
                if (sessionActive && state != OutsideAppVoiceState.IDLE) {
                    startForegroundCompat()
                    updateOverlay()
                } else {
                    sessionActive = true
                    setState(OutsideAppVoiceState.LISTENING)
                }
            }
            ACTION_PAUSE -> {
                if (!sessionActive) sessionActive = true
                pauseWakeCapture()
                setState(OutsideAppVoiceState.PAUSED)
            }
            ACTION_RESUME -> {
                if (!sessionActive) sessionActive = true
                resumeWakeCapture()
                setState(OutsideAppVoiceState.LISTENING, "resume")
            }
            ACTION_SET_STATE -> {
                if (!sessionActive) sessionActive = true
                setState(OutsideAppVoiceState.fromWireName(intent.getStringExtra(EXTRA_STATE)))
            }
            ACTION_SET_APPROVAL -> {
                if (!sessionActive) sessionActive = true
                approvalPrompt = sanitizeApprovalPrompt(intent.getStringExtra(EXTRA_APPROVAL_PROMPT))
                approvalToken = sanitizeApprovalToken(intent.getStringExtra(EXTRA_APPROVAL_TOKEN))
                setState(OutsideAppVoiceState.APPROVAL)
            }
            ACTION_APPROVE -> {
                sendVoiceSessionEvent("approval_approve")
                setState(OutsideAppVoiceState.WORKING)
            }
            ACTION_DENY -> {
                sendVoiceSessionEvent("approval_deny")
                approvalPrompt = ""
                approvalToken = ""
                setState(OutsideAppVoiceState.LISTENING)
            }
            ACTION_E2E_SIMULATE_CRASH -> {
                simulateUnexpectedStopForE2e(startId)
                return START_NOT_STICKY
            }
            ACTION_OPEN -> {
                if (sessionActive) {
                    startForegroundCompat()
                    updateOverlay()
                }
                openJarvis()
            }
            ACTION_END -> {
                endSession()
            }
            else -> {
                expectedStop = true
                state = OutsideAppVoiceState.IDLE
                sessionActive = false
                overlayController.remove()
                stopSelf(startId)
                return START_NOT_STICKY
            }
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        if (!expectedStop && sessionActive && state != OutsideAppVoiceState.IDLE) {
            endTalkModeCapture()
            sendVoiceSessionEvent("crash")
            endedSessionBlocksPlayback = true
        }
        overlayController.remove()
        if (instance === this) instance = null
        super.onDestroy()
    }

    fun stateForTest(): OutsideAppVoiceState = state

    fun sessionActiveForTest(): Boolean = sessionActive

    private fun simulateUnexpectedStopForE2e(startId: Int) {
        expectedStop = false
        if (!sessionActive) sessionActive = true
        if (state == OutsideAppVoiceState.IDLE) state = OutsideAppVoiceState.LISTENING
        DaemonLog.add("outside_app_voice: e2e simulated crash")
        stopSelf(startId)
    }

    private fun setStateFromAnyThread(nextState: OutsideAppVoiceState) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            if (sessionActive) setState(nextState)
            return
        }
        mainHandler.post {
            if (sessionActive) setState(nextState)
        }
    }

    internal fun onOverlayTapped() {
        when (OutsideAppVoiceSessionStateMachine.overlayTapAction(state)) {
            OutsideAppVoiceOverlayTapAction.INTERRUPT_AND_LISTEN -> {
                JarvisVoicePlaybackController.stopActivePlayback(rearmTalkMode = true)
                sendVoiceSessionEvent("interrupt")
                setState(OutsideAppVoiceState.LISTENING)
            }
            OutsideAppVoiceOverlayTapAction.OPEN_CONTROLS -> overlayController.showControls()
        }
    }

    internal fun onOverlayPause() {
        pauseWakeCapture()
        setState(OutsideAppVoiceState.PAUSED)
    }

    internal fun onOverlayResume() {
        resumeWakeCapture()
        setState(OutsideAppVoiceState.LISTENING, "resume")
    }

    internal fun onOverlayEnd() {
        endSession()
    }

    internal fun onOverlayOpen() {
        openJarvis()
    }

    private fun pauseWakeCapture() {
        JarvisVoicePlaybackController.stopActivePlayback(rearmTalkMode = false)
        WakeWordService.pauseForUserControl()
        DaemonLog.add("outside_app_voice: wake capture paused")
    }

    private fun resumeWakeCapture() {
        WakeWordService.onTtsFinished()
        DaemonLog.add("outside_app_voice: wake capture resumed")
    }

    internal fun onOverlayApprove() {
        sendVoiceSessionEvent("approval_approve")
        setState(OutsideAppVoiceState.WORKING)
    }

    internal fun onOverlayDeny() {
        sendVoiceSessionEvent("approval_deny")
        approvalPrompt = ""
        setState(OutsideAppVoiceState.LISTENING)
    }

    private fun setState(nextState: OutsideAppVoiceState, actionName: String = nextState.wireName) {
        if (nextState != OutsideAppVoiceState.IDLE) {
            expectedStop = false
        }
        if (nextState != OutsideAppVoiceState.APPROVAL) {
            approvalPrompt = ""
            approvalToken = ""
        }
        state = nextState
        startForegroundCompat()
        updateOverlay()
        sendVoiceSessionEvent(actionName)
    }

    private fun endSession() {
        expectedStop = true
        endedSessionBlocksPlayback = true
        JarvisVoicePlaybackController.stopActivePlayback(rearmTalkMode = false)
        endTalkModeCapture()
        sendVoiceSessionEvent("end")
        approvalPrompt = ""
        approvalToken = ""
        state = OutsideAppVoiceState.IDLE
        sessionActive = false
        overlayController.remove()
        @Suppress("DEPRECATION")
        stopForeground(true)
        stopSelf()
    }

    private fun endTalkModeCapture() {
        if (WakeWordService.instance == null) return
        WakeWordService.endTalkModeForUserControl()
    }

    private fun startForegroundCompat() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateOverlay() {
        overlayController.render(state, approvalPrompt)
    }

    private fun sanitizeApprovalPrompt(prompt: String?): String {
        return prompt
            ?.replace(Regex("\\s+"), " ")
            ?.trim()
            ?.take(120)
            ?: ""
    }

    private fun sanitizeApprovalToken(token: String?): String {
        return token
            ?.replace(Regex("\\s+"), "")
            ?.trim()
            ?.take(200)
            ?: ""
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Jarvis voice session",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Controls the active Jarvis voice session"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val openPendingIntent = PendingIntent.getActivity(
            this,
            40,
            openJarvisIntent(),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Jarvis voice")
            .setContentText(OutsideAppVoiceSessionStateMachine.notificationText(state))
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(openPendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)

        OutsideAppVoiceSessionStateMachine.notificationActions().forEachIndexed { index, actionItem ->
            builder.addAction(
                0,
                actionItem.label,
                notificationActionPendingIntent(actionItem, 50 + index),
            )
        }
        return builder.build()
    }

    private fun notificationActionPendingIntent(
        actionItem: OutsideAppVoiceNotificationAction,
        requestCode: Int,
    ): PendingIntent {
        if (actionItem.action == ACTION_OPEN) {
            return PendingIntent.getActivity(
                this,
                requestCode,
                openJarvisIntent(),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        return PendingIntent.getService(
            this,
            requestCode,
            controlIntent(this, actionItem.action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun openJarvisIntent(): Intent {
        return Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("jarvis://voice-realtime?source=outside_app")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
    }

    private fun openJarvis() {
        startActivity(openJarvisIntent())
    }

    private fun sendVoiceSessionEvent(actionName: String) {
        val confirmationToken = approvalToken
        val reactActive = JarvisDaemonModule.emitVoiceSessionControl(
            actionName,
            state.wireName,
            confirmationToken,
        )
        val event = JSONObject().apply {
            put("type", "voice_session_control")
            put("action", actionName)
            put("state", state.wireName)
            put("outsideApp", true)
            put("reactActive", reactActive)
            if (confirmationToken.isNotBlank()) {
                put("confirmationToken", confirmationToken)
            }
        }
        WebSocketService.sendEvent(event.toString())
        DaemonLog.add("voice_session: $actionName state=${state.wireName}")
    }
}

class OutsideAppVoiceOverlayController(
    private val service: OutsideAppVoiceSessionService,
) {
    private var windowManager: WindowManager? = null
    private var root: LinearLayout? = null
    private var controls: LinearLayout? = null
    private var approvalPanel: LinearLayout? = null
    private var approvalText: TextView? = null

    fun render(state: OutsideAppVoiceState, approvalPrompt: String = "") {
        if (!canDrawOverlay()) {
            remove()
            return
        }
        val view = ensureView()
        updateMic(view, state)
        updateApprovalPanel(state, approvalPrompt)
    }

    fun showControls() {
        if ((root?.tag as? OutsideAppVoiceState) == OutsideAppVoiceState.APPROVAL) return
        controls?.visibility = View.VISIBLE
    }

    fun remove() {
        val manager = windowManager
        val view = root
        if (manager != null && view != null) {
            runCatching { manager.removeView(view) }
        }
        root = null
        controls = null
        approvalPanel = null
        approvalText = null
        windowManager = null
    }

    private fun canDrawOverlay(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(service)
    }

    private fun ensureView(): LinearLayout {
        root?.let { return it }

        val manager = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        windowManager = manager
        val container = LinearLayout(service).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(8, 8, 8, 8)
            setBackgroundColor(Color.argb(190, 10, 12, 20))
            contentDescription = "Jarvis voice controls"
        }
        val mic = TextView(service).apply {
            text = "MIC"
            textSize = 24f
            gravity = Gravity.CENTER
            setPadding(12, 10, 12, 10)
            setOnClickListener { service.onOverlayTapped() }
        }
        val actionRow = LinearLayout(service).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            visibility = View.GONE
        }
        val approvalRow = LinearLayout(service).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            visibility = View.GONE
            contentDescription = "Jarvis approval controls"
        }
        val promptText = TextView(service).apply {
            text = "Approve this action?"
            textSize = 12f
            setTextColor(Color.WHITE)
            setPadding(10, 6, 10, 4)
            gravity = Gravity.CENTER
            maxLines = 2
        }
        val approvalButtons = LinearLayout(service).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        approvalButtons.addView(controlButton("Approve") { service.onOverlayApprove() })
        approvalButtons.addView(controlButton("Deny") { service.onOverlayDeny() })
        approvalRow.addView(promptText)
        approvalRow.addView(approvalButtons)
        actionRow.addView(controlButton("Pause") { service.onOverlayPause() })
        actionRow.addView(controlButton("Resume") { service.onOverlayResume() })
        actionRow.addView(controlButton("End") { service.onOverlayEnd() })
        actionRow.addView(controlButton("Open") { service.onOverlayOpen() })
        container.addView(mic)
        container.addView(approvalRow)
        container.addView(actionRow)
        controls = actionRow
        approvalPanel = approvalRow
        approvalText = promptText

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            },
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = 24
            y = 160
        }
        manager.addView(container, params)
        root = container
        return container
    }

    private fun updateMic(container: LinearLayout, state: OutsideAppVoiceState) {
        container.tag = state
        val mic = container.getChildAt(0) as? TextView ?: return
        mic.contentDescription = "Jarvis voice ${state.wireName}"
        mic.setTextColor(
            when (state) {
                OutsideAppVoiceState.LISTENING -> Color.rgb(34, 197, 94)
                OutsideAppVoiceState.SPEAKING -> Color.rgb(59, 130, 246)
                OutsideAppVoiceState.WORKING -> Color.rgb(168, 85, 247)
                OutsideAppVoiceState.APPROVAL -> Color.rgb(245, 158, 11)
                OutsideAppVoiceState.PAUSED -> Color.rgb(148, 163, 184)
                OutsideAppVoiceState.IDLE -> Color.WHITE
            },
        )
    }

    private fun updateApprovalPanel(state: OutsideAppVoiceState, approvalPrompt: String) {
        val panel = approvalPanel ?: return
        val isApproval = state == OutsideAppVoiceState.APPROVAL
        panel.visibility = if (isApproval) View.VISIBLE else View.GONE
        controls?.visibility = if (isApproval) View.GONE else controls?.visibility ?: View.GONE
        approvalText?.text = if (approvalPrompt.isNotBlank()) approvalPrompt else "Approve this action?"
    }

    private fun controlButton(label: String, onClick: () -> Unit): TextView {
        return TextView(service).apply {
            text = label
            textSize = 12f
            setTextColor(Color.WHITE)
            setPadding(12, 8, 12, 8)
            contentDescription = "Jarvis voice $label"
            setOnClickListener { onClick() }
        }
    }
}
