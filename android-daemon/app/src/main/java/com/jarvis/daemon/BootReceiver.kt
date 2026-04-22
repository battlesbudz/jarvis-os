package com.jarvis.daemon

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action !in listOf(
                Intent.ACTION_BOOT_COMPLETED,
                Intent.ACTION_MY_PACKAGE_REPLACED
            )
        ) return

        val prefs = context.getSharedPreferences(WebSocketService.PREFS_NAME, Context.MODE_PRIVATE)
        val serverUrl = prefs.getString(WebSocketService.PREF_SERVER_URL, "") ?: ""
        val daemonId = prefs.getString(WebSocketService.PREF_DAEMON_ID, "") ?: ""
        val reconnectSecret = prefs.getString(WebSocketService.PREF_RECONNECT_SECRET, "") ?: ""

        // Only auto-start if we have all three persisted credentials.
        // Both daemonId and reconnectSecret are required for secure proof-of-possession reconnect.
        if (serverUrl.isNotEmpty() && daemonId.isNotEmpty() && reconnectSecret.isNotEmpty()) {
            Log.i("JarvisBoot", "Auto-reconnecting daemon after boot (daemonId=${daemonId.take(8)}…)")
            val serviceIntent = Intent(context, WebSocketService::class.java).apply {
                action = WebSocketService.ACTION_RECONNECT
                putExtra(WebSocketService.EXTRA_SERVER_URL, serverUrl)
                putExtra(WebSocketService.EXTRA_DAEMON_ID, daemonId)
                putExtra(WebSocketService.EXTRA_RECONNECT_SECRET, reconnectSecret)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        } else {
            Log.i("JarvisBoot", "Skipping auto-reconnect — missing credentials " +
                "(url=${serverUrl.isNotEmpty()}, id=${daemonId.isNotEmpty()}, secret=${reconnectSecret.isNotEmpty()})")
        }
    }
}
