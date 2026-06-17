package com.gameplan.daemon

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class DaemonE2eReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_E2E_BOOTSTRAP) return

        val serviceIntent = Intent(context, WebSocketService::class.java).apply {
            action = WebSocketService.ACTION_BOOTSTRAP
            putExtra(
                WebSocketService.EXTRA_SERVER_URL,
                intent.getStringExtra(WebSocketService.EXTRA_SERVER_URL) ?: "",
            )
            putExtra(
                WebSocketService.EXTRA_BOOTSTRAP_TOKEN,
                intent.getStringExtra(WebSocketService.EXTRA_BOOTSTRAP_TOKEN) ?: "",
            )
        }
        ContextCompat.startForegroundService(context, serviceIntent)
    }

    companion object {
        const val ACTION_E2E_BOOTSTRAP = "com.gameplan.daemon.E2E_BOOTSTRAP"
    }
}
