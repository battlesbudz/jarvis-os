package com.jarvis.daemon

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
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

class WebSocketService : Service() {

    companion object {
        const val ACTION_CONNECT = "com.jarvis.daemon.CONNECT"
        const val ACTION_RECONNECT = "com.jarvis.daemon.RECONNECT"
        const val ACTION_DISCONNECT = "com.jarvis.daemon.DISCONNECT"
        const val EXTRA_SERVER_URL = "server_url"
        const val EXTRA_PAIR_CODE = "pair_code"
        const val EXTRA_DAEMON_ID = "daemon_id"
        const val EXTRA_RECONNECT_SECRET = "reconnect_secret"
        private const val TAG = "JarvisWS"
        private const val CHANNEL_ID = "jarvis_daemon"
        private const val NOTIFICATION_ID = 1001
        private const val RECONNECT_DELAY_MS = 5000L
        private const val PING_INTERVAL_MS = 25000L
        const val PREFS_NAME = "jarvis_daemon"
        const val PREF_SERVER_URL = "server_url"
        const val PREF_DAEMON_ID = "daemon_id"
        const val PREF_RECONNECT_SECRET = "reconnect_secret"
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
    private var daemonId: String = ""
    private var reconnectSecret: String = ""
    private var paired = false
    private var reconnectEnabled = true
    private var pingFuture: java.util.concurrent.ScheduledFuture<*>? = null

    var isConnected = false
    var currentStatus = "Disconnected"
    var onStatusChanged: ((String, Boolean) -> Unit)? = null

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, buildNotification("Starting…"),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(NOTIFICATION_ID, buildNotification("Starting…"))
        }

        // Load persisted credentials
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        serverUrl = prefs.getString(PREF_SERVER_URL, "") ?: ""
        daemonId = prefs.getString(PREF_DAEMON_ID, "") ?: ""
        reconnectSecret = prefs.getString(PREF_RECONNECT_SECRET, "") ?: ""
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONNECT -> {
                val url = intent.getStringExtra(EXTRA_SERVER_URL) ?: return START_STICKY
                val code = intent.getStringExtra(EXTRA_PAIR_CODE) ?: return START_STICKY
                serverUrl = url
                pairCode = code
                paired = false
                reconnectEnabled = true
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit().putString(PREF_SERVER_URL, url).apply()
                connect(useDaemonId = false)
            }
            ACTION_RECONNECT -> {
                // Boot or restart reconnect — use persisted credentials
                val url = intent.getStringExtra(EXTRA_SERVER_URL) ?: serverUrl
                val id = intent.getStringExtra(EXTRA_DAEMON_ID) ?: daemonId
                val secret = intent.getStringExtra(EXTRA_RECONNECT_SECRET) ?: reconnectSecret
                if (url.isNotEmpty() && id.isNotEmpty() && secret.isNotEmpty()) {
                    serverUrl = url
                    daemonId = id
                    reconnectSecret = secret
                    reconnectEnabled = true
                    connect(useDaemonId = true)
                } else {
                    Log.i(TAG, "Skipping auto-reconnect — missing credentials")
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

    private fun connect(useDaemonId: Boolean) {
        disconnect()
        val wsUrl = buildWsUrl(serverUrl)
        val mode = if (useDaemonId && daemonId.isNotEmpty() && reconnectSecret.isNotEmpty()) "reconnect" else "pair"
        Log.i(TAG, "Connecting to $wsUrl [$mode]")
        updateStatus("Connecting…", false)

        wsClient = object : WebSocketClient(URI(wsUrl)) {
            override fun onOpen(handshakedata: ServerHandshake?) {
                Log.i(TAG, "WebSocket opened")
                if (!paired) {
                    if (useDaemonId && daemonId.isNotEmpty() && reconnectSecret.isNotEmpty()) {
                        sendReconnectMessage()
                    } else {
                        sendPairMessage()
                    }
                }
                schedulePing()
            }

            override fun onMessage(message: String?) {
                if (message == null) return
                try {
                    val json = JSONObject(message)
                    handleMessage(json)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to parse message: $message", e)
                }
            }

            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                Log.w(TAG, "WebSocket closed: code=$code reason=$reason remote=$remote")
                pingFuture?.cancel(false)
                isConnected = false
                paired = false
                updateStatus("Disconnected", false)
                if (reconnectEnabled) {
                    scheduleReconnect(preferDaemonId = daemonId.isNotEmpty() && reconnectSecret.isNotEmpty())
                }
            }

            override fun onError(ex: Exception?) {
                Log.e(TAG, "WebSocket error", ex)
                updateStatus("Error: ${ex?.message ?: "unknown"}", false)
            }
        }
        try {
            wsClient?.connect()
        } catch (e: Exception) {
            Log.e(TAG, "Connect failed", e)
            if (reconnectEnabled) {
                scheduleReconnect(preferDaemonId = daemonId.isNotEmpty() && reconnectSecret.isNotEmpty())
            }
        }
    }

    private fun buildWsUrl(serverUrl: String): String {
        val base = serverUrl.trimEnd('/')
        return when {
            base.startsWith("https://") -> base.replace("https://", "wss://") + "/api/daemon/ws"
            base.startsWith("http://") -> base.replace("http://", "ws://") + "/api/daemon/ws"
            else -> "wss://$base/api/daemon/ws"
        }
    }

    private fun sendPairMessage() {
        val msg = JSONObject().apply {
            put("type", "pair")
            put("code", pairCode)
            put("platform", "android")
            put("hostname", Build.MODEL)
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
        }
        send(msg.toString())
    }

    private fun handleMessage(json: JSONObject) {
        when (val type = json.optString("type")) {
            "hello" -> {
                if (json.optBoolean("ok")) {
                    paired = true
                    isConnected = true
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
                    updateStatus("Connected • ${Build.MODEL}", true)
                    Log.i(TAG, "Paired/reconnected successfully")
                } else {
                    val err = json.optString("error", "pairing failed")
                    updateStatus("Pair failed: $err", false)
                    // Server rejected our credentials — clear them so user must re-pair
                    if (err.contains("invalid reconnect secret") || err.contains("re-pair") ||
                        err.contains("legacy pair") || err.contains("unknown daemonId")) {
                        daemonId = ""
                        reconnectSecret = ""
                        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                            .remove(PREF_DAEMON_ID)
                            .remove(PREF_RECONNECT_SECRET)
                            .apply()
                        reconnectEnabled = false
                        Log.w(TAG, "Credentials invalidated — user must re-pair")
                    }
                    Log.e(TAG, "Pairing/reconnect failed: $err")
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
        updateStatus("Reconnecting in 5s…", false)
        executor.schedule({
            if (reconnectEnabled) connect(useDaemonId = preferDaemonId)
        }, RECONNECT_DELAY_MS, TimeUnit.MILLISECONDS)
    }

    private fun disconnect() {
        pingFuture?.cancel(false)
        try {
            wsClient?.closeBlocking()
        } catch (e: Exception) {
            Log.w(TAG, "Disconnect error", e)
        }
        wsClient = null
        isConnected = false
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
                "Jarvis Daemon",
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
            .setContentTitle("Jarvis Daemon")
            .setContentText(status)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun updateNotification(status: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification(status))
    }

    override fun onDestroy() {
        reconnectEnabled = false
        disconnect()
        executor.shutdownNow()
        super.onDestroy()
    }
}
