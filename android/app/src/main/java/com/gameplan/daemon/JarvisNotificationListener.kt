package com.gameplan.daemon

import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList

class JarvisNotificationListener : NotificationListenerService() {

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

        val hasReplyAction = notif.actions?.any { action ->
            action.remoteInputs?.isNotEmpty() == true
        } ?: false

        val obj = JSONObject()
            .put("pkg", pkg)
            .put("app", appLabel)
            .put("title", title ?: "")
            .put("text", text ?: "")
            .put("ts", System.currentTimeMillis())
            .put("key", sbn.key)
            .put("hasReplyAction", hasReplyAction)

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

    fun replyToNotification(context: Context, key: String, text: String): OpResult {
        val active = try {
            activeNotifications
        } catch (e: Exception) {
            return OpResult(false, error = "Cannot access active notifications: ${e.message}")
        }
        val sbn = active?.firstOrNull { it.key == key }
            ?: return OpResult(false, error = "Notification with key '$key' is no longer active or has been dismissed.")
        val actions = sbn.notification.actions
        if (actions.isNullOrEmpty()) {
            return OpResult(false, error = "This notification has no actions and cannot be replied to.")
        }
        val replyAction = actions.firstOrNull { action ->
            action.remoteInputs?.isNotEmpty() == true
        } ?: return OpResult(false, error = "This notification does not expose a text reply action (no RemoteInput found). Try opening the app and replying manually.")
        return try {
            val remoteInputs = replyAction.remoteInputs!!
            val bundle = Bundle()
            for (ri in remoteInputs) {
                bundle.putCharSequence(ri.resultKey, text)
            }
            val fillIn = Intent()
            RemoteInput.addResultsToIntent(remoteInputs, fillIn, bundle)
            replyAction.actionIntent.send(context, 0, fillIn)
            Log.i(TAG, "Notification reply sent: key=$key text_length=${text.length}")
            OpResult(true, data = JSONObject()
                .put("replied", true)
                .put("key", key)
                .put("replyText", text))
        } catch (e: PendingIntent.CanceledException) {
            OpResult(false, error = "The notification's reply action was cancelled or expired. The app may have already handled it.")
        } catch (e: Exception) {
            OpResult(false, error = "Failed to send reply: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "JarvisNotifListener"
        private const val MAX_CACHED = 60

        val recent = CopyOnWriteArrayList<JSONObject>()

        var instance: JarvisNotificationListener? = null
            private set

        private val DENY_PACKAGES = setOf(
            "com.gameplan",
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

        fun performReply(context: Context, key: String, text: String): OpResult {
            return instance?.replyToNotification(context, key, text)
                ?: OpResult(false, error = "Notification listener service is not connected. Grant notification access in Settings > Notifications > Device & App Notifications > Jarvis app.")
        }
    }
}
