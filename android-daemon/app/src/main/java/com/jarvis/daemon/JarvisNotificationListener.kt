package com.jarvis.daemon

import android.app.Notification
import android.content.pm.PackageManager
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList

class JarvisNotificationListener : NotificationListenerService() {

    companion object {
        private const val TAG = "JarvisNotifListener"
        private const val MAX_CACHED = 60

        // Thread-safe ring buffer of recent notifications (newest first)
        val recent = CopyOnWriteArrayList<JSONObject>()

        var instance: JarvisNotificationListener? = null
            private set

        // Skip our own daemon and pure system noise
        private val DENY_PACKAGES = setOf(
            "com.jarvis.daemon",
            "android",
            "com.android.systemui",
            "com.android.phone",
            "com.google.android.gms",
            "com.samsung.android.app.smartcapture",
            "com.samsung.android.SettingsIntelligence",
        )

        fun getRecentJson(limit: Int = 20): JSONArray {
            val arr = JSONArray()
            recent.take(limit).forEach { arr.put(it) }
            return arr
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        instance = this
        Log.i(TAG, "Notification listener connected")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        instance = null
        Log.i(TAG, "Notification listener disconnected")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return
        val pkg = sbn.packageName ?: return
        if (pkg in DENY_PACKAGES) return
        if (sbn.isOngoing) return

        val notif = sbn.notification ?: return
        val extras = notif.extras ?: return

        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.trim()

        if (title.isNullOrEmpty() && text.isNullOrEmpty()) return

        val appLabel = try {
            packageManager.getApplicationLabel(
                packageManager.getApplicationInfo(pkg, PackageManager.GET_META_DATA)
            ).toString()
        } catch (e: Exception) { pkg }

        val obj = JSONObject()
            .put("pkg", pkg)
            .put("app", appLabel)
            .put("title", title ?: "")
            .put("text", text ?: "")
            .put("ts", System.currentTimeMillis())
            .put("key", sbn.key)

        // Ring buffer — newest first
        recent.add(0, obj)
        while (recent.size > MAX_CACHED) recent.removeAt(recent.size - 1)

        Log.d(TAG, "Notification from $appLabel: $title")

        // Forward to server over WebSocket (best-effort, won't fail the listener)
        try {
            val event = JSONObject()
                .put("type", "notification_event")
                .put("notification", obj)
            WebSocketService.sendEvent(event.toString())
        } catch (e: Exception) {
            Log.w(TAG, "Failed to forward notification: ${e.message}")
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // Not forwarded — keep cache clean only
        sbn ?: return
        val key = sbn.key ?: return
        recent.removeIf { it.optString("key") == key }
    }
}
