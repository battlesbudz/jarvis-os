package com.jarvis.daemon

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.util.Base64
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class OpResult(val ok: Boolean, val data: Any? = null, val error: String? = null)

object OpHandler {

    private const val TAG = "JarvisOp"

    fun handle(context: Context, op: JSONObject): OpResult {
        return try {
            when (val type = op.optString("type")) {
                "android_open_app" -> handleOpenApp(context, op)
                "android_browse" -> handleBrowse(context, op)
                "android_screenshot" -> handleScreenshot()
                "android_read_screen" -> handleReadScreen()
                "android_tap" -> handleTap(op)
                "android_type" -> handleType(op)
                "android_swipe" -> handleSwipe(op)
                "android_press_key" -> handlePressKey(op)
                "android_file_list" -> handleFileList(op)
                "android_file_read" -> handleFileRead(op)
                "notify" -> handleNotify(context, op)
                else -> OpResult(false, error = "Unknown op type: $type")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Op failed", e)
            OpResult(false, error = e.message ?: "unknown error")
        }
    }

    private fun handleOpenApp(context: Context, op: JSONObject): OpResult {
        val packageName = op.optString("packageName").ifEmpty {
            return OpResult(false, error = "packageName required")
        }
        val pm = context.packageManager
        val launchIntent = pm.getLaunchIntentForPackage(packageName)
            ?: return OpResult(false, error = "App not installed: $packageName")
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        val appLabel = try {
            pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
        } catch (e: Exception) { packageName }

        // Require the accessibility service to be running for direct launch.
        // Without it, background activity starts are silently blocked on Android 10+ / Samsung OneUI.
        val svc = JarvisAccessibilityService.instance
        if (svc == null) {
            // Show a tappable notification as a best-effort fallback
            val pi = PendingIntent.getActivity(
                context, packageName.hashCode(), launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            NotificationHelper.showAction(context, "▶ Open $appLabel", "Tap to open (accessibility service offline)", pi, packageName.hashCode())
            return OpResult(
                false,
                error = "Accessibility service is not running — the app could NOT be launched automatically. " +
                    "A notification has been shown on your phone as a fallback (tap it to open $appLabel manually). " +
                    "To fix autonomous control: go to Settings > Accessibility > Installed Apps > Jarvis Daemon and enable it."
            )
        }

        var launched = false
        try {
            launched = svc.launchApp(packageName)
        } catch (e: Exception) {
            Log.w(TAG, "Direct accessibility launch failed: ${e.message}")
        }

        if (!launched) {
            // Service is running but launch was blocked (Samsung background restriction).
            // Show tappable notification as fallback.
            val pi = PendingIntent.getActivity(
                context, packageName.hashCode(), launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            NotificationHelper.showAction(context, "▶ Open $appLabel", "Tap to open now", pi, packageName.hashCode())
            return OpResult(
                false,
                error = "Background launch was blocked by Android (Samsung OneUI restriction). " +
                    "A notification has appeared on your phone — tap '▶ Open $appLabel' to open it manually. " +
                    "Alternatively, ask me to open it again while the screen is on and the phone is unlocked."
            )
        }

        return OpResult(
            true,
            data = JSONObject()
                .put("appName", appLabel)
                .put("package", packageName)
                .put("launched", true)
        )
    }

    private fun handleBrowse(context: Context, op: JSONObject): OpResult {
        val url = op.optString("url").ifEmpty {
            return OpResult(false, error = "url required")
        }

        val svc = JarvisAccessibilityService.instance
        if (svc == null) {
            val viewIntent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val pi = PendingIntent.getActivity(
                context, url.hashCode(), viewIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val shortUrl = if (url.length > 50) url.take(47) + "…" else url
            NotificationHelper.showAction(context, "▶ Open Link", shortUrl, pi, url.hashCode())
            return OpResult(
                false,
                error = "Accessibility service is not running — the URL could NOT be opened automatically. " +
                    "A notification has been shown on your phone (tap it to open the link). " +
                    "To fix: Settings > Accessibility > Installed Apps > Jarvis Daemon and enable it."
            )
        }

        var opened = false
        try {
            opened = svc.browseUrl(url)
        } catch (e: Exception) {
            Log.w(TAG, "Direct browse launch failed: ${e.message}")
        }

        if (!opened) {
            val viewIntent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val pi = PendingIntent.getActivity(
                context, url.hashCode(), viewIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val shortUrl = if (url.length > 50) url.take(47) + "…" else url
            NotificationHelper.showAction(context, "▶ Open Link", shortUrl, pi, url.hashCode())
            return OpResult(
                false,
                error = "Background launch was blocked by Android. A notification has appeared on your phone — tap it to open the link."
            )
        }

        return OpResult(
            true,
            data = JSONObject()
                .put("url", url)
                .put("opened", true)
        )
    }

    private fun handleScreenshot(): OpResult {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return OpResult(false, error = "Screenshot via accessibility requires Android 11 (API 30) or newer. This device runs API ${Build.VERSION.SDK_INT}.")
        }
        val svc = JarvisAccessibilityService.instance
            ?: return OpResult(false, error = "Accessibility service not running. Enable it in Settings > Accessibility > Jarvis Daemon.")
        return try {
            val base64 = svc.takeScreenshotBase64()
            if (base64 != null) {
                OpResult(true, data = JSONObject().put("screenshot", base64).put("format", "png"))
            } else {
                OpResult(false, error = "Screenshot failed — ensure accessibility service is enabled and screen is on")
            }
        } catch (e: Exception) {
            OpResult(false, error = "Screenshot error: ${e.message}")
        }
    }

    private fun handleReadScreen(): OpResult {
        val svc = JarvisAccessibilityService.instance
            ?: return OpResult(false, error = "Accessibility service not running. Enable it in Settings > Accessibility > Jarvis Daemon.")
        return try {
            val json = JSONObject(svc.readScreenContent())
            // Return structured data directly so the server gets package/activity/text/clickable fields
            OpResult(true, data = json)
        } catch (e: Exception) {
            OpResult(false, error = "Read screen error: ${e.message}")
        }
    }

    private fun handleTap(op: JSONObject): OpResult {
        val x = op.optDouble("x", Double.NaN)
        val y = op.optDouble("y", Double.NaN)
        if (x.isNaN() || y.isNaN()) return OpResult(false, error = "x and y required")
        val svc = JarvisAccessibilityService.instance
            ?: return OpResult(false, error = "Accessibility service not running.")
        svc.performTap(x.toFloat(), y.toFloat())
        return OpResult(true, data = JSONObject().put("tapped", "${x.toInt()},${y.toInt()}"))
    }

    private fun handleType(op: JSONObject): OpResult {
        val text = op.optString("text").ifEmpty {
            return OpResult(false, error = "text required")
        }
        val svc = JarvisAccessibilityService.instance
            ?: return OpResult(false, error = "Accessibility service not running.")
        svc.typeText(text)
        return OpResult(true, data = JSONObject().put("typed", text.length))
    }

    private fun handleSwipe(op: JSONObject): OpResult {
        val x1 = op.optDouble("x1", Double.NaN)
        val y1 = op.optDouble("y1", Double.NaN)
        val x2 = op.optDouble("x2", Double.NaN)
        val y2 = op.optDouble("y2", Double.NaN)
        val durationMs = op.optLong("durationMs", 300L)
        if (x1.isNaN() || y1.isNaN() || x2.isNaN() || y2.isNaN()) {
            return OpResult(false, error = "x1, y1, x2, y2 required")
        }
        val svc = JarvisAccessibilityService.instance
            ?: return OpResult(false, error = "Accessibility service not running.")
        svc.performSwipe(x1.toFloat(), y1.toFloat(), x2.toFloat(), y2.toFloat(), durationMs)
        return OpResult(true, data = JSONObject().put("swiped", "${x1.toInt()},${y1.toInt()} → ${x2.toInt()},${y2.toInt()}"))
    }

    private fun handlePressKey(op: JSONObject): OpResult {
        val key = op.optString("key", "back")
        val svc = JarvisAccessibilityService.instance
            ?: return OpResult(false, error = "Accessibility service not running.")
        svc.pressKey(key)
        return OpResult(true, data = JSONObject().put("key", key))
    }

    private fun handleFileList(op: JSONObject): OpResult {
        val path = op.optString("path").ifEmpty {
            return OpResult(false, error = "path required")
        }
        val resolvedPath = resolvePath(path)
        val dir = File(resolvedPath)
        if (!dir.exists()) return OpResult(false, error = "Path not found: $resolvedPath")
        if (!dir.isDirectory) return OpResult(false, error = "Not a directory: $resolvedPath")
        val files = dir.listFiles() ?: return OpResult(false, error = "Cannot list directory — check storage permission")
        val arr = JSONArray()
        for (f in files.take(500)) {
            arr.put(JSONObject().apply {
                put("name", f.name)
                put("path", f.absolutePath)
                put("isDir", f.isDirectory)
                put("size", if (f.isFile) f.length() else 0)
                put("lastModified", f.lastModified())
            })
        }
        return OpResult(true, data = JSONObject().put("path", resolvedPath).put("files", arr).put("count", files.size))
    }

    private fun handleFileRead(op: JSONObject): OpResult {
        val path = op.optString("path").ifEmpty {
            return OpResult(false, error = "path required")
        }
        val resolvedPath = resolvePath(path)
        val file = File(resolvedPath)
        if (!file.exists()) return OpResult(false, error = "File not found: $resolvedPath")
        if (!file.isFile) return OpResult(false, error = "Not a file: $resolvedPath")
        if (file.length() > 10 * 1024 * 1024) {
            return OpResult(false, error = "File too large (max 10 MB): ${file.length()} bytes")
        }
        return try {
            val bytes = file.readBytes()
            val isText = bytes.take(1024).none { it < 0x08 || (it in 0x0E..0x1F && it != 0x1B.toByte()) }
            if (isText) {
                OpResult(true, data = JSONObject()
                    .put("path", resolvedPath)
                    .put("content", String(bytes, Charsets.UTF_8))
                    .put("encoding", "utf-8")
                    .put("size", bytes.size))
            } else {
                OpResult(true, data = JSONObject()
                    .put("path", resolvedPath)
                    .put("content", Base64.encodeToString(bytes, Base64.NO_WRAP))
                    .put("encoding", "base64")
                    .put("size", bytes.size))
            }
        } catch (e: Exception) {
            OpResult(false, error = "Read failed: ${e.message}")
        }
    }

    private fun handleNotify(context: Context, op: JSONObject): OpResult {
        val title = op.optString("title", "Jarvis")
        val body = op.optString("body", "")
        NotificationHelper.show(context, title, body)
        return OpResult(true, data = JSONObject().put("notified", true))
    }

    private fun resolvePath(path: String): String {
        return when {
            path.startsWith("/") -> path
            path == "downloads" || path == "Downloads" ->
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).absolutePath
            path == "dcim" || path == "DCIM" || path == "gallery" ->
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM).absolutePath
            path == "documents" || path == "Documents" ->
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS).absolutePath
            path == "pictures" || path == "Pictures" ->
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES).absolutePath
            path == "music" || path == "Music" ->
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC).absolutePath
            path == "movies" || path == "Movies" ->
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES).absolutePath
            else -> Environment.getExternalStorageDirectory().absolutePath + "/$path"
        }
    }
}
