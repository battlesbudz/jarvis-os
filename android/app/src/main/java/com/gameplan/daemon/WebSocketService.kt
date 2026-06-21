package com.gameplan.daemon

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.gameplan.MainActivity
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import org.json.JSONObject
import java.net.URI
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/** Thread-safe in-memory log ring buffer. Max 30 entries. UI observes via listener. */
object DaemonLog {
    private const val MAX = 30
    private val entries = ArrayDeque<String>(MAX)
    private val lock = Any()
    var onChanged: (() -> Unit)? = null

    fun add(msg: String) {
        val ts = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
        val line = "[$ts] $msg"
        Log.d("JarvisLog", line)
        synchronized(lock) {
            if (entries.size >= MAX) entries.removeFirst()
            entries.addLast(line)
        }
        onChanged?.invoke()
    }

    fun getAll(): List<String> = synchronized(lock) { entries.toList() }
}

class WebSocketService : Service() {

    companion object {
        const val ACTION_CONNECT = "com.gameplan.daemon.CONNECT"
        const val ACTION_BOOTSTRAP = "com.gameplan.daemon.BOOTSTRAP"
        const val ACTION_RECONNECT = "com.gameplan.daemon.RECONNECT"
        const val ACTION_DISCONNECT = "com.gameplan.daemon.DISCONNECT"
        const val EXTRA_SERVER_URL = "server_url"
        const val EXTRA_PAIR_CODE = "pair_code"
        const val EXTRA_BOOTSTRAP_TOKEN = "bootstrap_token"
        const val EXTRA_DAEMON_ID = "daemon_id"
        const val EXTRA_RECONNECT_SECRET = "reconnect_secret"
        private const val TAG = "JarvisWS"
        private const val CHANNEL_ID = "jarvis_daemon"
        private const val NOTIFICATION_ID = 1001
        private const val RECONNECT_DELAY_MS = 5000L
        private const val RECONNECT_DELAY_MAX_MS = 60000L
        private const val PING_INTERVAL_MS = 25000L
        const val PREFS_NAME = "jarvis_daemon"
        const val PREF_SERVER_URL = "server_url"
        const val PREF_DAEMON_ID = "daemon_id"
        const val PREF_RECONNECT_SECRET = "reconnect_secret"

        // Static instance reference — used by JarvisNotificationListener to push events
        @Volatile var instance: WebSocketService? = null
            private set

        /** Send an arbitrary JSON string event to the server (best-effort, no throw). */
        fun sendEvent(json: String) {
            instance?.send(json)
        }
    }

    inner class LocalBinder : Binder() {
        fun getService(): WebSocketService = this@WebSocketService
    }

    private val binder = LocalBinder()
    private var wsClient: WebSocketClient? = null
    private val executor: ScheduledExecutorService = Executors.newScheduledThreadPool(2)
    private val mainHandler = Handler(Looper.getMainLooper())

    // Connection state
    private var serverUrl: String = ""
    private var pairCode: String = ""
    private var bootstrapToken: String = ""
    private var daemonId: String = ""
    private var reconnectSecret: String = ""
    private var paired = false
    private var reconnectEnabled = true
    private var currentConnectUsesDaemonId = false
    private var currentConnectUsesBootstrapToken = false
    private var reconnectAttempts = 0
    private val maxReconnectAttempts = 8
    private var pingFuture: java.util.concurrent.ScheduledFuture<*>? = null
    private var reconnectFuture: java.util.concurrent.ScheduledFuture<*>? = null
    private var reconnectDelayMs = RECONNECT_DELAY_MS
    private var connecting = false
    private var currentWsUrl = ""
    private var currentConnectMode = ""

    var isConnected = false
    var currentStatus = "Disconnected"
    var onStatusChanged: ((String, Boolean) -> Unit)? = null

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        // Load persisted credentials — do NOT call startForeground() here.
        // startForeground() is only valid when the service is started via
        // startForegroundService(), not when it is only bound.
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val rawServerUrl = prefs.getString(PREF_SERVER_URL, "") ?: ""
        serverUrl = JarvisConfig.normalizeServerUrl(rawServerUrl)
        if (rawServerUrl != serverUrl) {
            prefs.edit().putString(PREF_SERVER_URL, serverUrl).apply()
        }
        daemonId = prefs.getString(PREF_DAEMON_ID, "") ?: ""
        reconnectSecret = prefs.getString(PREF_RECONNECT_SECRET, "") ?: ""
    }

    private fun startForegroundCompat(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, buildNotification("Starting…"),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
            startForeground(NOTIFICATION_ID, buildNotification("Starting…"))
        }
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start foreground daemon service", e)
            DaemonLog.add("Device Control start failed: ${e.message ?: "foreground service denied"}")
            currentStatus = "Device Control start failed: ${e.message ?: "foreground service denied"}"
            isConnected = false
            mainHandler.post { onStatusChanged?.invoke(currentStatus, false) }
            false
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!startForegroundCompat()) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        when (intent?.action) {
            ACTION_CONNECT -> {
                val url = JarvisConfig.normalizeServerUrl(intent.getStringExtra(EXTRA_SERVER_URL))
                val code = intent.getStringExtra(EXTRA_PAIR_CODE) ?: return START_STICKY
                serverUrl = url
                pairCode = code
                paired = false
                reconnectEnabled = true
                reconnectAttempts = 0
                reconnectDelayMs = RECONNECT_DELAY_MS
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit().putString(PREF_SERVER_URL, url).apply()
                connect(useDaemonId = false)
            }
            ACTION_BOOTSTRAP -> {
                val url = JarvisConfig.normalizeServerUrl(intent.getStringExtra(EXTRA_SERVER_URL))
                val token = intent.getStringExtra(EXTRA_BOOTSTRAP_TOKEN) ?: return START_STICKY
                serverUrl = url
                bootstrapToken = token
                pairCode = ""
                paired = false
                reconnectEnabled = true
                reconnectAttempts = 0
                reconnectDelayMs = RECONNECT_DELAY_MS
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit().putString(PREF_SERVER_URL, url).apply()
                connect(useDaemonId = false, useBootstrapToken = true)
            }
            ACTION_RECONNECT -> {
                // Boot or restart reconnect — use persisted credentials
                val url = JarvisConfig.normalizeServerUrl(intent.getStringExtra(EXTRA_SERVER_URL) ?: serverUrl)
                val id = intent.getStringExtra(EXTRA_DAEMON_ID) ?: daemonId
                val secret = intent.getStringExtra(EXTRA_RECONNECT_SECRET) ?: reconnectSecret
                if (url.isNotEmpty() && id.isNotEmpty() && secret.isNotEmpty()) {
                    serverUrl = url
                    daemonId = id
                    reconnectSecret = secret
                    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .edit().putString(PREF_SERVER_URL, url).apply()
                    reconnectEnabled = true
                    connect(useDaemonId = true)
                } else {
                    Log.i(TAG, "Skipping auto-reconnect — missing credentials")
                }
            }
            null -> {
                if (serverUrl.isNotEmpty() && daemonId.isNotEmpty() && reconnectSecret.isNotEmpty()) {
                    reconnectEnabled = true
                    connect(useDaemonId = true)
                } else {
                    Log.i(TAG, "Skipping sticky restart reconnect — missing credentials")
                }
            }
            ACTION_DISCONNECT -> {
                reconnectEnabled = false
                paired = false
                // Clear all persisted credentials so boot won't auto-reconnect
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                    .remove(PREF_DAEMON_ID)
                    .remove(PREF_RECONNECT_SECRET)
                    .apply()
                daemonId = ""
                reconnectSecret = ""
                disconnect()
                updateStatus("Disconnected", false)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_STICKY
    }

    private fun connect(useDaemonId: Boolean, useBootstrapToken: Boolean = false) {
        val nextConnectUsesDaemonId = useDaemonId && daemonId.isNotEmpty() && reconnectSecret.isNotEmpty()
        val nextConnectUsesBootstrapToken = !nextConnectUsesDaemonId && useBootstrapToken && bootstrapToken.isNotEmpty()
        val wsUrl = buildWsUrl(serverUrl)
        val mode = when {
            nextConnectUsesDaemonId -> "reconnect"
            nextConnectUsesBootstrapToken -> "bootstrap"
            else -> "pair"
        }
        if (wsClient != null && isConnected && currentWsUrl == wsUrl) {
            paired = true
            reconnectAttempts = 0
            reconnectDelayMs = RECONNECT_DELAY_MS
            DaemonLog.add("WS already connected; ignoring duplicate $mode connect")
            return
        }
        if (wsClient != null && connecting && currentWsUrl == wsUrl && currentConnectMode == mode) {
            DaemonLog.add("WS connect already in progress; ignoring duplicate $mode connect")
            return
        }
        reconnectFuture?.cancel(false)
        reconnectFuture = null
        closeCurrentSocket(scheduleReconnectOnClose = false)
        currentConnectUsesDaemonId = nextConnectUsesDaemonId
        currentConnectUsesBootstrapToken = nextConnectUsesBootstrapToken
        currentWsUrl = wsUrl
        currentConnectMode = mode
        connecting = true
        Log.i(TAG, "Connecting to $wsUrl [$mode]")
        updateStatus("Connecting…", false)

        wsClient = object : WebSocketClient(URI(wsUrl)) {
            override fun onOpen(handshakedata: ServerHandshake?) {
                if (wsClient !== this) {
                    DaemonLog.add("WS stale open ignored")
                    return
                }
                Log.i(TAG, "WebSocket opened")
                DaemonLog.add("WS opened → sending $mode")
                if (!paired) {
                    if (nextConnectUsesDaemonId) {
                        sendReconnectMessage()
                    } else if (nextConnectUsesBootstrapToken) {
                        sendBootstrapMessage()
                    } else {
                        sendPairMessage()
                    }
                }
                schedulePing()
            }

            override fun onMessage(message: String?) {
                if (message == null) return
                if (wsClient !== this) {
                    DaemonLog.add("WS stale message ignored")
                    return
                }
                try {
                    val json = JSONObject(message)
                    handleMessage(json)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to parse message: $message", e)
                }
            }

            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                Log.w(TAG, "WebSocket closed: code=$code reason=$reason remote=$remote")
                DaemonLog.add("WS closed: code=$code reason=${reason ?: "none"}")
                val isCurrentClient = wsClient === this
                val isIntentionalClose = wsClient == null
                val shouldReconnect = reconnectEnabled && isCurrentClient
                if (!isCurrentClient && !isIntentionalClose) {
                    DaemonLog.add("WS stale close ignored")
                    return
                }
                if (isCurrentClient) {
                    wsClient = null
                }
                pingFuture?.cancel(false)
                pingFuture = null
                connecting = false
                isConnected = false
                paired = false
                updateStatus("Disconnected", false)
                if (shouldReconnect) {
                    scheduleReconnect(preferDaemonId = daemonId.isNotEmpty() && reconnectSecret.isNotEmpty())
                }
            }

            override fun onError(ex: Exception?) {
                if (wsClient !== this) {
                    DaemonLog.add("WS stale error ignored")
                    return
                }
                Log.e(TAG, "WebSocket error", ex)
                connecting = false
                DaemonLog.add("WS error: ${ex?.message ?: "unknown"}")
                updateStatus("Error: ${ex?.message ?: "unknown"}", false)
            }
        }
        try {
            wsClient?.connect()
        } catch (e: Exception) {
            Log.e(TAG, "Connect failed", e)
            connecting = false
            if (reconnectEnabled) {
                scheduleReconnect(preferDaemonId = daemonId.isNotEmpty() && reconnectSecret.isNotEmpty())
            }
        }
    }

    private fun buildWsUrl(serverUrl: String): String {
        val base = JarvisConfig.normalizeServerUrl(serverUrl).trimEnd('/')
        return when {
            base.startsWith("https://") -> base.replace("https://", "wss://") + "/api/daemon/ws"
            base.startsWith("http://") -> base.replace("http://", "ws://") + "/api/daemon/ws"
            else -> "wss://$base/api/daemon/ws"
        }
    }

    private fun sendBootstrapMessage() {
        val msg = JSONObject().apply {
            put("type", "android_app_bootstrap")
            put("bootstrapToken", bootstrapToken)
            put("platform", "android")
            put("hostname", Build.MODEL)
            putUnifiedClientMetadata(this)
        }
        send(msg.toString())
    }

    private fun sendPairMessage() {
        val msg = JSONObject().apply {
            put("type", "pair")
            put("code", pairCode)
            put("platform", "android")
            put("hostname", Build.MODEL)
            putUnifiedClientMetadata(this)
        }
        send(msg.toString())
    }

    private fun sendReconnectMessage() {
        val msg = JSONObject().apply {
            put("type", "reconnect")
            put("daemonId", daemonId)
            put("reconnectSecret", reconnectSecret)
            put("platform", "android")
            put("hostname", Build.MODEL)
            putUnifiedClientMetadata(this)
        }
        send(msg.toString())
    }

    private fun putUnifiedClientMetadata(msg: JSONObject) {
        msg.put("clientKind", "unified_android_app")
        msg.put("appPackage", packageName)
        runCatching {
            packageManager.getPackageInfo(packageName, 0).versionName
        }.getOrNull()
            ?.takeIf { it.isNotBlank() }
            ?.let { msg.put("appVersion", it) }
    }

    private fun handleMessage(json: JSONObject) {
        when (val type = json.optString("type")) {
            "hello" -> {
                if (json.optBoolean("ok")) {
                    connecting = false
                    paired = true
                    isConnected = true
                    bootstrapToken = ""
                    // On first pair, server issues daemonId + reconnectSecret (both server-generated,
                    // high-entropy). Store them securely for future reconnections.
                    val serverDaemonId = json.optString("daemonId", "")
                    val serverReconnectSecret = json.optString("reconnectSecret", "")
                    if (serverDaemonId.isNotEmpty() && serverReconnectSecret.isNotEmpty()) {
                        daemonId = serverDaemonId
                        reconnectSecret = serverReconnectSecret
                        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                            .putString(PREF_DAEMON_ID, serverDaemonId)
                            .putString(PREF_RECONNECT_SECRET, serverReconnectSecret)
                            .putString(PREF_SERVER_URL, serverUrl)
                            .apply()
                        Log.i(TAG, "Credentials stored for future reconnect (daemonId=${serverDaemonId.take(8)}…)")
                    }
                    reconnectAttempts = 0
                    reconnectDelayMs = RECONNECT_DELAY_MS
                    updateStatus("Connected • ${Build.MODEL}", true)
                    Log.i(TAG, "Connected successfully")
                    // Log permission status so the user (and AI via daemon_diagnostic) can see it immediately
                    val a11yEnabled = JarvisAccessibilityService.instance != null
                    val notifEnabled = JarvisNotificationListener.instance != null
                    DaemonLog.add("connected userId=${json.optString("userId", "?")}")
                    DaemonLog.add("accessibility=${if (a11yEnabled) "ENABLED ✓" else "DISABLED ✗ — phone control will not work!"}")
                    DaemonLog.add("notifications=${if (notifEnabled) "ENABLED ✓" else "DISABLED ✗ — notification reading unavailable"}")
                } else {
                    connecting = false
                    val err = json.optString("error", "connection failed")
                    DaemonLog.add("connect FAILED: $err")
                    updateStatus("Connection failed: $err", false)
                    // Server rejected our credentials — clear them so user must re-pair
                    if (currentConnectUsesDaemonId &&
                        (err.contains("invalid reconnect secret") || err.contains("re-pair") ||
                            err.contains("legacy pair") || err.contains("unknown daemonId"))) {
                        daemonId = ""
                        reconnectSecret = ""
                        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                            .remove(PREF_DAEMON_ID)
                            .remove(PREF_RECONNECT_SECRET)
                            .apply()
                        reconnectEnabled = false
                        Log.w(TAG, "Credentials invalidated — user must re-pair")
                    } else if (currentConnectUsesBootstrapToken) {
                        bootstrapToken = ""
                        reconnectEnabled = false
                        Log.w(TAG, "Bootstrap token rejected — user must enable device control again")
                    } else if (!currentConnectUsesDaemonId) {
                        pairCode = ""
                        reconnectEnabled = false
                        Log.w(TAG, "Pair code rejected — user must request a fresh code")
                    }
                    Log.e(TAG, "Daemon connection failed: $err")
                }
            }
            "op" -> {
                val opId = json.optString("id")
                val op = json.optJSONObject("op") ?: return
                executor.submit {
                    val result = OpHandler.handle(applicationContext, op)
                    val response = JSONObject().apply {
                        put("type", "result")
                        put("id", opId)
                        put("ok", result.ok)
                        if (result.data != null) put("data", result.data)
                        if (result.error != null) put("error", result.error)
                    }
                    send(response.toString())
                }
            }
            "pong" -> { /* heartbeat response */ }
            else -> Log.d(TAG, "Unknown message type: $type")
        }
    }

    private fun send(message: String) {
        try {
            wsClient?.send(message)
        } catch (e: Exception) {
            Log.e(TAG, "Send failed", e)
        }
    }

    private fun schedulePing() {
        pingFuture?.cancel(false)
        pingFuture = executor.scheduleAtFixedRate({
            try {
                send(JSONObject().put("type", "ping").toString())
            } catch (e: Exception) {
                Log.e(TAG, "Ping failed", e)
            }
        }, PING_INTERVAL_MS, PING_INTERVAL_MS, TimeUnit.MILLISECONDS)
    }

    private fun scheduleReconnect(preferDaemonId: Boolean) {
        if (!reconnectEnabled) return
        if (isConnected || connecting) {
            DaemonLog.add("WS reconnect skipped; connection already active")
            return
        }
        reconnectFuture?.cancel(false)
        reconnectAttempts++
        // Never clear credentials on reconnect failure — keep retrying with exponential backoff
        // capped at RECONNECT_DELAY_MAX_MS (60s). Credentials are only cleared on explicit
        // server rejection (bad secret / unknown daemonId) or user-initiated disconnect.
        val delay = reconnectDelayMs
        reconnectDelayMs = minOf(reconnectDelayMs * 2, RECONNECT_DELAY_MAX_MS)
        val delaySec = delay / 1000
        updateStatus("Reconnecting (attempt $reconnectAttempts, ${delaySec}s)…", false)
        DaemonLog.add("WS reconnect scheduled in ${delaySec}s (attempt $reconnectAttempts)")
        reconnectFuture = executor.schedule({
            if (reconnectEnabled && !isConnected && !connecting) {
                connect(useDaemonId = preferDaemonId && daemonId.isNotEmpty() && reconnectSecret.isNotEmpty())
            }
        }, delay, TimeUnit.MILLISECONDS)
    }

    private fun disconnect() {
        reconnectFuture?.cancel(false)
        reconnectFuture = null
        closeCurrentSocket(scheduleReconnectOnClose = false)
        isConnected = false
        paired = false
        connecting = false
    }

    private fun closeCurrentSocket(scheduleReconnectOnClose: Boolean) {
        pingFuture?.cancel(false)
        pingFuture = null
        val client = wsClient ?: return
        if (!scheduleReconnectOnClose) {
            wsClient = null
        }
        try {
            client.closeBlocking()
        } catch (e: Exception) {
            Log.w(TAG, "Disconnect error", e)
        } finally {
            if (wsClient === client) {
                wsClient = null
            }
        }
    }

    private fun updateStatus(status: String, connected: Boolean) {
        currentStatus = status
        isConnected = connected
        updateNotification(status)
        mainHandler.post { onStatusChanged?.invoke(status, connected) }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val chan = NotificationChannel(
                CHANNEL_ID,
                "Jarvis app",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps the Jarvis Android daemon running"
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(chan)
        }
    }

    private fun buildNotification(status: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Jarvis app")
            .setContentText(status)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun updateNotification(status: String) {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIFICATION_ID, buildNotification(status))
        } catch (e: Exception) {
            Log.w(TAG, "Notification update failed", e)
        }
    }

    override fun onDestroy() {
        instance = null
        reconnectEnabled = false
        LocalGemmaInferenceEngine.shutdown()
        disconnect()
        executor.shutdownNow()
        super.onDestroy()
    }
}
