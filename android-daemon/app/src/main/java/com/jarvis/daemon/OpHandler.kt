package com.jarvis.daemon

import android.Manifest
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.SystemClock
import android.telephony.SmsManager
import android.util.Base64
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

data class OpResult(val ok: Boolean, val data: Any? = null, val error: String? = null)

object OpHandler {

    private const val TAG = "JarvisOp"

    fun handle(context: Context, op: JSONObject): OpResult {
        val type = op.optString("type")
        val startMs = SystemClock.elapsedRealtime()
        DaemonLog.add("op received: $type")
        return try {
            val result = when (type) {
                "ping" -> handlePing()
                "android_open_app" -> handleOpenApp(context, op)
                "android_browse" -> handleBrowse(context, op)
                "android_return_to_jarvis" -> handleReturnToJarvis(context)
                "android_screenshot" -> handleScreenshot()
                "android_read_screen" -> handleReadScreen()
                "android_tap" -> handleTap(op)
                "android_type" -> handleType(op)
                "android_swipe" -> handleSwipe(op)
                "android_press_key" -> handlePressKey(op)
                "android_file_list" -> handleFileList(op)
                "android_file_read" -> handleFileRead(op)
                "android_notifications_list" -> handleNotificationsList(op)
                "android_notification_reply" -> handleNotificationReply(context, op)
                "android_file_search" -> handleFileSearch(op)
                "android_open_file" -> handleOpenFile(context, op)
                "android_copy_to_clipboard" -> handleCopyToClipboard(context, op)
                "notify" -> handleNotify(context, op)
                "voice_set_wake_words" -> handleSetWakeWords(context, op)
                "voice_set_talk_mode" -> handleSetTalkMode(context, op)
                "voice_tts_finished" -> handleTtsFinished()
                "voice_speak_audio" -> handleSpeakAudio(context, op)
                "android_camera_snap" -> CameraHandler.handleSnap(context, op)
                "android_camera_clip" -> CameraHandler.handleClip(context, op)
                "android_location_get" -> handleLocationGet(context, op)
                "android_sms_send" -> handleSmsSend(context, op)
                "android_screen_record" -> ScreenRecordHandler.handleScreenRecord(context, op)
                "android_view_hierarchy" -> handleViewHierarchy()
                "android_paste_text" -> handlePasteText(context, op)
                "android_get_focused_field" -> handleGetFocusedField()
                "android_clear_field" -> handleClearField()
                "android_start_training" -> handleStartTraining(op)
                else -> OpResult(false, error = "Unknown op type: $type")
            }
            val durationMs = SystemClock.elapsedRealtime() - startMs
            if (result.ok) {
                DaemonLog.add("op OK: $type (${durationMs}ms)")
            } else {
                DaemonLog.add("op FAILED: $type — ${result.error} (${durationMs}ms)")
            }
            result
        } catch (e: Exception) {
            val durationMs = SystemClock.elapsedRealtime() - startMs
            Log.e(TAG, "Op failed", e)
            DaemonLog.add("op EXCEPTION: $type — ${e.message} (${durationMs}ms)")
            OpResult(false, error = e.message ?: "unknown error")
        }
    }

    private fun handlePing(): OpResult {
        val svc = JarvisAccessibilityService.instance
        val accessibilityEnabled = svc != null
        val notificationListenerActive = JarvisNotificationListener.instance != null
        val foregroundPackage = try {
            svc?.rootInActiveWindow?.packageName?.toString() ?: "unknown"
        } catch (e: Exception) { "unknown" }

        return OpResult(
            ok = true,
            data = JSONObject()
                .put("model", Build.MODEL)
                .put("manufacturer", Build.MANUFACTURER)
                .put("androidVersion", Build.VERSION.RELEASE)
                .put("sdkInt", Build.VERSION.SDK_INT)
                .put("accessibilityEnabled", accessibilityEnabled)
                .put("notificationListenerActive", notificationListenerActive)
                .put("foregroundPackage", foregroundPackage)
                .put("uptimeMs", SystemClock.elapsedRealtime())
        )
    }

    // Many apps ship under multiple package names (lite vs full, different stores, beta).
    // When the requested package has no launch intent, try these alternatives before
    // declaring the app not installed.
    private val packageFallbacks = mapOf(
        "com.facebook.katana"         to listOf("com.facebook.lite", "com.facebook.mlite"),
        "com.facebook.lite"           to listOf("com.facebook.katana"),
        "com.twitter.android"         to listOf("com.twitter.android.lite", "com.atebits.tweetie2"),
        "com.twitter.android.lite"    to listOf("com.twitter.android"),
        "com.reddit.frontpage"        to listOf("com.reddit.frontpage.debug"),
        "com.tiktok.tiktok"           to listOf("com.ss.android.ugc.trill", "com.zhiliaoapp.musically"),
        "com.ss.android.ugc.trill"    to listOf("com.tiktok.tiktok", "com.zhiliaoapp.musically"),
        "com.google.android.apps.messaging" to listOf("com.samsung.android.messaging"),
        "com.samsung.android.messaging"     to listOf("com.google.android.apps.messaging"),
        "com.microsoft.teams"         to listOf("com.microsoft.teams2"),
        "com.snapchat.android"        to listOf("com.snapchat.android.debug"),
        "com.discord"                 to listOf("com.discord.development"),
        "com.linkedin.android"        to listOf("com.linkedin.android.lite"),
        "com.amazon.mShop.android.shopping" to listOf("com.amazon.windowshop"),
        "com.ubercab"                 to listOf("com.ubercab.driver"),
        "com.pinterest"               to listOf("com.pinterest.twa"),
    )

    private fun handleOpenApp(context: Context, op: JSONObject): OpResult {
        val requestedPackage = op.optString("packageName").ifEmpty {
            return OpResult(false, error = "packageName required")
        }
        val pm = context.packageManager

        // Build candidate list: requested package + any known fallbacks
        val candidates = (listOf(requestedPackage) + (packageFallbacks[requestedPackage] ?: emptyList()))

        var resolvedPackage: String? = null
        var launchIntent: Intent? = null
        for (pkg in candidates) {
            val intent = pm.getLaunchIntentForPackage(pkg)
            if (intent != null) {
                resolvedPackage = pkg
                launchIntent = intent
                if (pkg != requestedPackage) {
                    Log.i(TAG, "Package fallback: $requestedPackage → $pkg")
                    DaemonLog.add("package fallback: $requestedPackage → $pkg")
                }
                break
            }
        }

        if (launchIntent == null || resolvedPackage == null) {
            val tried = candidates.joinToString(", ")
            return OpResult(false, error = "App not installed (tried: $tried). The app may be in Secure Folder or installed for a different user profile.")
        }

        val packageName = resolvedPackage
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

    private fun handleReturnToJarvis(context: Context): OpResult {
        // Bring the browser to the foreground WITHOUT opening a URL.
        //
        // KEY INSIGHT: using browseUrl() (Intent.ACTION_VIEW + FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        // causes Chrome to navigate to the URL, which triggers a full page reload.
        // A page reload kills the SSE stream that is actively delivering the AI response,
        // causing the "something went wrong" error the user sees when Chrome reopens.
        //
        // FIX: use getLaunchIntentForPackage() + FLAG_ACTIVITY_REORDER_TO_FRONT instead.
        // This brings the existing Chrome activity (with the Jarvis tab already open) to the
        // foreground without reloading the page — the SSE stream survives and delivers normally.
        val browserPackages = listOf(
            "com.android.chrome",
            "com.samsung.android.app.sbrowser", // Samsung Internet
            "com.chrome.beta",
            "com.chrome.dev",
            "org.mozilla.firefox"
        )
        for (pkg in browserPackages) {
            try {
                val launchIntent = context.packageManager.getLaunchIntentForPackage(pkg) ?: continue
                launchIntent.addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                    // Intentionally NO FLAG_ACTIVITY_RESET_TASK_IF_NEEDED — that clears the
                    // back stack and forces a reload, killing the live SSE connection.
                )
                context.startActivity(launchIntent)
                DaemonLog.add("return_to_jarvis: brought $pkg to foreground (no reload)")
                return OpResult(true, data = JSONObject().put("returned", true).put("pkg", pkg))
            } catch (e: Exception) {
                DaemonLog.add("return_to_jarvis: $pkg failed: ${e.message}")
            }
        }

        // Last resort: open the URL directly (may cause page reload in some browsers)
        val svc = JarvisAccessibilityService.instance
        if (svc == null) {
            val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://GameplanAI.replit.app")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val pi = android.app.PendingIntent.getActivity(
                context, "return_jarvis".hashCode(), intent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )
            NotificationHelper.showAction(context, "↩ Return to Jarvis", "Tap to reopen the Jarvis chat", pi, "return_jarvis".hashCode())
            return OpResult(false, error = "No browser found to bring to foreground — showed notification")
        }
        val opened = try { svc.browseUrl("https://GameplanAI.replit.app") } catch (e: Exception) { false }
        return if (opened) {
            OpResult(true, data = JSONObject().put("returned", true).put("url", "https://GameplanAI.replit.app"))
        } else {
            OpResult(false, error = "Could not navigate back to Jarvis")
        }
    }

    private fun handleScreenshot(): OpResult {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return OpResult(false, error = "Screenshot via accessibility requires Android 11 (API 30) or newer. This device runs API ${Build.VERSION.SDK_INT}.")
        }
        val svc = JarvisAccessibilityService.instance
            ?: return OpResult(false, error = "Accessibility service not running. Enable it in Settings > Accessibility > Jarvis Daemon.")
        return try {
            // Method 1: Direct AccessibilityService.takeScreenshot() API
            var base64 = svc.takeScreenshotBase64()

            // Method 2: If direct API fails, try simulating the hardware screenshot button.
            // Samsung's system screenshot service uses a different code path that works in more situations.
            if (base64 == null) {
                Log.i(TAG, "Direct screenshot API failed — trying global action fallback")
                DaemonLog.add("screenshot: direct API failed, trying global action fallback")
                base64 = svc.takeScreenshotViaGlobalAction()
            }

            if (base64 != null) {
                OpResult(true, data = JSONObject().put("screenshot", base64).put("format", "jpeg"))
            } else {
                val pkg = try { svc.rootInActiveWindow?.packageName?.toString() ?: "unknown" } catch (e: Exception) { "unknown" }
                val hint = when {
                    pkg == "com.android.chrome" || pkg == "com.chrome.beta" || pkg == "com.chrome.dev" ->
                        "Chrome has FLAG_SECURE active. This almost always means you have at least one " +
                        "incognito tab open — Chrome applies FLAG_SECURE to the entire app when ANY incognito " +
                        "tab exists, blocking all screenshot APIs. Fix: open Chrome → tap the tab switcher → " +
                        "close all incognito tabs (the dark tab group), then retry the screenshot. " +
                        "Alternatively, use Samsung Internet as your browser for Jarvis instead of Chrome."
                    pkg in setOf("com.facebook.katana", "com.facebook.lite", "com.instagram.android",
                        "com.whatsapp", "com.snapchat.android", "com.netflix.mediaclient",
                        "com.amazon.avod.thirdpartyclient", "com.disney.disneyplus") ->
                        "This app ($pkg) uses FLAG_SECURE which blocks all screenshot APIs at the OS level. " +
                        "Use android_read_screen instead — it reads the accessibility tree which works even in FLAG_SECURE apps."
                    else ->
                        "Screenshot failed for package '$pkg'. Both screenshot methods failed. " +
                        "Possible causes: FLAG_SECURE window is active (Chrome incognito, banking app, etc.), " +
                        "screen is locked, or display ID was not detected. " +
                        "Use android_read_screen to read visible text instead."
                }
                OpResult(false, error = hint)
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
        val submit = op.optBoolean("submit", false)
        val svc = JarvisAccessibilityService.instance
            ?: return OpResult(false, error = "Accessibility service not running.")
        val ok = svc.typeText(text, submit)
        return OpResult(
            ok = ok,
            data = JSONObject()
                .put("typed", text.length)
                .put("submitted", submit && ok),
            error = if (!ok) "No editable field found — tap a text input first, then type" else null
        )
    }

    // ── android_paste_text ───────────────────────────────────────────────────
    // Inputs text into the currently-focused field using a two-step fallback
    // chain specifically designed for custom-IME fields (Facebook search bar,
    // Instagram, etc.) where ACTION_SET_TEXT fails silently:
    //
    //   Step 1 (primary)  — adb-style `input text` via Runtime.exec()
    //                        Proper %s/%% escaping, no shell involvement.
    //                        Works reliably on most Android versions when the
    //                        field accepts direct key injection.
    //
    //   Step 2 (fallback) — ClipboardManager + ACTION_PASTE via accessibility
    //                        Sets clipboard on main thread (required Android 10+),
    //                        then sends ACTION_PASTE to the focused/first editable node.
    //
    // After whichever step succeeds, reads back the field text via accessibility
    // to verify the text actually appeared.
    //
    // Returns {ok, verified, method_used, field_text, is_password} so the
    // server can decide whether to retry with a different approach.
    private fun handlePasteText(context: Context, op: JSONObject): OpResult {
        val text = op.optString("text").ifEmpty {
            return OpResult(false, error = "text required")
        }
        val fieldDescription = op.optString("fieldDescription", "input field")

        val svc = JarvisAccessibilityService.instance
            ?: return OpResult(false, error = "Accessibility service not running. Enable it in Settings > Accessibility > Jarvis Daemon.")

        // ── Step 1 (primary): adb-style input text via Runtime.exec ──────────
        // `input text` accepts %s for space and %% for literal percent.
        // We pass tokens directly (no sh -c) so shell metacharacters in the text
        // are never interpreted by a shell — only the `input` binary sees them.
        var methodUsed: String? = null
        try {
            val encoded = text.replace("%", "%%").replace(" ", "%s")
            val proc = Runtime.getRuntime().exec(arrayOf("input", "text", encoded))
            val exited = proc.waitFor(5, TimeUnit.SECONDS)
            val exitCode = if (exited) proc.exitValue() else -1
            if (exitCode == 0) {
                methodUsed = "input_text_exec"
                Log.i(TAG, "paste_text: input text exec succeeded for '$fieldDescription'")
            } else {
                Log.w(TAG, "paste_text: input text exec exit=$exitCode — trying clipboard fallback")
            }
        } catch (e: Exception) {
            Log.w(TAG, "paste_text: input text exec exception: ${e.message} — trying clipboard fallback")
        }

        // ── Step 2 (fallback): ClipboardManager + ACTION_PASTE ───────────────
        if (methodUsed == null) {
            try {
                val pasteOk = svc.pasteFromClipboard(text)
                if (pasteOk) {
                    methodUsed = "clipboard_paste"
                    Log.i(TAG, "paste_text: clipboard paste succeeded for '$fieldDescription'")
                } else {
                    Log.w(TAG, "paste_text: clipboard paste returned false for '$fieldDescription'")
                }
            } catch (e: Exception) {
                Log.w(TAG, "paste_text: clipboard paste exception: ${e.message}")
            }
        }

        if (methodUsed == null) {
            return OpResult(
                ok = false,
                error = "Both input methods failed for '$fieldDescription' (input text exec + clipboard paste). " +
                    "Ensure the field is focused — tap it first, then retry."
            )
        }

        // ── Verify: read field text back via accessibility ────────────────────
        Thread.sleep(200)
        val fieldInfo = svc.getFocusedFieldInfo()
        val fieldText = fieldInfo.text
        // Password fields hide their content — treat as verified if the field is focused and active
        val verified = when {
            fieldInfo.isPassword -> fieldInfo.focused
            fieldText != null -> fieldText == text || fieldText.trim() == text.trim() || fieldText.contains(text)
            else -> false
        }

        val resultData = JSONObject()
            .put("ok", true)
            .put("verified", verified)
            .put("method_used", methodUsed)
            .put("field_text", fieldText ?: JSONObject.NULL)
            .put("is_password", fieldInfo.isPassword)
            .put("field", fieldDescription)

        Log.i(TAG, "paste_text: method=$methodUsed verified=$verified fieldText='${fieldText?.take(30)}'")
        return OpResult(ok = true, data = resultData)
    }

    // Find the focused editable node starting from the given root.
    // This is an OpHandler-local helper (the service's version is private).
    private fun findFocusedEditable(node: android.view.accessibility.AccessibilityNodeInfo?): android.view.accessibility.AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isEditable && node.isFocused) return node
        for (i in 0 until node.childCount) {
            val result = findFocusedEditable(node.getChild(i))
            if (result != null) return result
        }
        return null
    }

    private fun findFirstEditable(node: android.view.accessibility.AccessibilityNodeInfo?): android.view.accessibility.AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isEditable) return node
        for (i in 0 until node.childCount) {
            val result = findFirstEditable(node.getChild(i))
            if (result != null) return result
        }
        return null
    }

    // ── android_get_focused_field ────────────────────────────────────────────
    // Lightweight accessibility query that returns the focused editable field's
    // text, hint, resource-id, and class — without a full hierarchy dump.
    // The server uses this to confirm focus before typing and to verify text
    // appeared in the field after input.
    private fun handleGetFocusedField(): OpResult {
        val svc = JarvisAccessibilityService.instance
            ?: return OpResult(false, error = "Accessibility service not running. Enable it in Settings > Accessibility > Jarvis Daemon.")

        val info = svc.getFocusedFieldInfo()
        val data = JSONObject()
            .put("focused", info.focused)
            .put("text", info.text ?: JSONObject.NULL)
            .put("hint", info.hint ?: JSONObject.NULL)
            .put("resourceId", info.resourceId ?: JSONObject.NULL)
            .put("className", info.className ?: JSONObject.NULL)
            .put("isPassword", info.isPassword)

        return OpResult(ok = true, data = data)
    }

    // ── android_clear_field ──────────────────────────────────────────────────
    // Clears the currently-focused editable field.
    // Delegates to JarvisAccessibilityService.clearField() which tries four
    // methods in order, stopping as soon as one succeeds:
    //   Step 1 — ACTION_SET_TEXT("") via the accessibility service (primary)
    //   Step 2 — ACTION_SET_SELECTION(0..len) + ACTION_SET_TEXT("") to delete; falls back to ACTION_CUT
    //   Step 3 — Re-find node from fresh window traversal + retry ACTION_SET_TEXT
    //   Step 4 — adb keyevent CTRL_A + DEL via Runtime.exec (hardware injection)
    // Each step verifies the field is actually empty afterward via node refresh.
    // Returns {ok, method, fieldWasAlreadyEmpty, verifiedEmpty} on success.
    private fun handleClearField(): OpResult {
        val svc = JarvisAccessibilityService.instance
            ?: return OpResult(false, error = "Accessibility service not running. Enable it in Settings > Accessibility > Jarvis Daemon.")

        val result = svc.clearField()
        return if (result.cleared) {
            OpResult(
                ok = true,
                data = JSONObject()
                    .put("method", result.method)
                    .put("cleared", true)
                    .put("fieldWasAlreadyEmpty", result.fieldWasAlreadyEmpty)
                    .put("verifiedEmpty", result.verifiedEmpty)
            )
        } else {
            OpResult(false, error = result.error ?: "Could not clear field — check that an editable field is focused")
        }
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

    private fun handleNotificationsList(op: JSONObject): OpResult {
        val limit = op.optInt("limit", 20).coerceIn(1, 60)
        val listenerRunning = JarvisNotificationListener.instance != null
        val arr = JarvisNotificationListener.getRecentJson(limit)
        return OpResult(
            ok = true,
            data = JSONObject()
                .put("notifications", arr)
                .put("count", arr.length())
                .put("listenerEnabled", listenerRunning)
                .put("hint", if (!listenerRunning) "Grant notification access in Settings > Notifications > Device & App Notifications > Jarvis Daemon" else null)
        )
    }

    private fun handleNotificationReply(context: Context, op: JSONObject): OpResult {
        val key = op.optString("notificationKey").ifEmpty {
            return OpResult(false, error = "notificationKey required")
        }
        val text = op.optString("replyText").ifEmpty {
            return OpResult(false, error = "replyText required")
        }
        return JarvisNotificationListener.performReply(context, key, text)
    }

    private fun handleNotify(context: Context, op: JSONObject): OpResult {
        val title = op.optString("title", "Jarvis")
        val body = op.optString("body", "")
        NotificationHelper.show(context, title, body)
        return OpResult(true, data = JSONObject().put("notified", true))
    }

    // ── android_file_search ──────────────────────────────────────────────────
    // Recursively walks the filesystem looking for files whose name contains
    // the query string (case-insensitive). Optional type filter and maxDepth.
    private fun handleFileSearch(op: JSONObject): OpResult {
        val query = op.optString("query").ifEmpty {
            return OpResult(false, error = "query required")
        }
        val rootPath = op.optString("root").ifEmpty { null }
            ?: Environment.getExternalStorageDirectory().absolutePath
        // Reads from "fileType" field. The server normalises any legacy "type" alias
        // before dispatching, so the daemon only needs to handle the canonical name.
        val typeFilter = op.optString("fileType", "any").lowercase()
        val maxDepth = op.optInt("maxDepth", 4).coerceIn(1, 8)

        val mimeCategories = mapOf(
            "image" to setOf("jpg","jpeg","png","gif","webp","bmp","heic","heif"),
            "video" to setOf("mp4","mkv","avi","mov","3gp","webm","ts"),
            "audio" to setOf("mp3","aac","flac","ogg","wav","m4a","opus"),
            "document" to setOf("pdf","doc","docx","xls","xlsx","ppt","pptx","txt","csv","json","xml","html","htm","md")
        )
        val allowedExts: Set<String>? = if (typeFilter == "any") null else mimeCategories[typeFilter]

        val results = mutableListOf<File>()

        fun walk(dir: File, depth: Int) {
            if (depth > maxDepth || results.size >= 100) return
            val children = try { dir.listFiles() } catch (e: SecurityException) { null } ?: return
            for (child in children) {
                if (results.size >= 100) break
                if (child.isFile) {
                    if (!child.name.contains(query, ignoreCase = true)) continue
                    if (allowedExts != null && child.extension.lowercase() !in allowedExts) continue
                    results.add(child)
                } else if (child.isDirectory) {
                    walk(child, depth + 1)
                }
            }
        }

        val rootDir = File(rootPath)
        if (!rootDir.exists()) return OpResult(false, error = "Root path not found: $rootPath")
        walk(rootDir, 1)

        val arr = JSONArray()
        for (f in results) {
            arr.put(JSONObject()
                .put("name", f.name)
                .put("path", f.absolutePath)
                .put("size", f.length())
                .put("lastModified", f.lastModified()))
        }
        return OpResult(
            ok = true,
            data = JSONObject()
                .put("query", query)
                .put("root", rootPath)
                .put("results", arr)
                .put("count", results.size)
        )
    }

    // ── android_open_file ─────────────────────────────────────────────────────
    // Opens a file in the appropriate app via ACTION_VIEW Intent.
    // For images this launches the gallery app at that specific file.
    private fun handleOpenFile(context: Context, op: JSONObject): OpResult {
        val path = op.optString("path").ifEmpty {
            return OpResult(false, error = "path required")
        }
        val file = File(path)
        if (!file.exists()) return OpResult(false, error = "File not found: $path")

        val ext = file.extension.lowercase()
        val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"

        return try {
            val uri = FileProvider.getUriForFile(
                context, "${context.packageName}.fileprovider", file
            )
            val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(viewIntent)
            OpResult(true, data = JSONObject()
                .put("path", path)
                .put("mimeType", mimeType)
                .put("opened", true))
        } catch (e: Exception) {
            Log.e(TAG, "android_open_file failed: ${e.message}")
            OpResult(false, error = "Could not open file: ${e.message}")
        }
    }

    // ── android_copy_to_clipboard ─────────────────────────────────────────────
    // Copies an image file to the Android clipboard as a content URI so it can
    // be pasted into any app that supports image paste (Telegram, WhatsApp, etc.).
    private fun handleCopyToClipboard(context: Context, op: JSONObject): OpResult {
        val path = op.optString("path").ifEmpty {
            return OpResult(false, error = "path required")
        }
        val file = File(path)
        if (!file.exists()) return OpResult(false, error = "File not found: $path")

        val ext = file.extension.lowercase()
        val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "image/*"
        val imageMime = if (mimeType.startsWith("image/")) mimeType else "image/*"

        return try {
            val uri = FileProvider.getUriForFile(
                context, "${context.packageName}.fileprovider", file
            )
            // Construct ClipData with an explicit MIME type array so receiving apps
            // (Telegram, WhatsApp, etc.) can reliably detect image content without
            // relying on ContentResolver MIME inference.
            val clipDescription = ClipDescription(file.name, arrayOf(imageMime))
            val clipData = ClipData(clipDescription, ClipData.Item(uri))
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(clipData)
            Log.i(TAG, "Copied to clipboard: $path (mime=$imageMime)")
            OpResult(true, data = JSONObject()
                .put("path", path)
                .put("mimeType", imageMime)
                .put("copied", true))
        } catch (e: Exception) {
            Log.e(TAG, "android_copy_to_clipboard failed: ${e.message}")
            OpResult(false, error = "Could not copy to clipboard: ${e.message}")
        }
    }

    // ── android_location_get ──────────────────────────────────────────────────

    private fun handleLocationGet(context: Context, op: JSONObject): OpResult {
        val preciseGranted = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarseGranted = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

        if (!preciseGranted && !coarseGranted) {
            return OpResult(
                false,
                error = "LOCATION_PERMISSION_REQUIRED: Location permission is not granted. " +
                    "Go to Settings → Apps → Jarvis Daemon → Permissions → Location and select 'Allow all the time' or 'Allow only while using the app'."
            )
        }

        val accuracyStr = op.optString("accuracy", "precise").lowercase()
        val maxAgeMs = if (op.has("maxAgeMs")) op.optLong("maxAgeMs") else -1L
        val priority = if (accuracyStr == "coarse" || !preciseGranted) Priority.PRIORITY_BALANCED_POWER_ACCURACY
                       else Priority.PRIORITY_HIGH_ACCURACY

        val client = LocationServices.getFusedLocationProviderClient(context)
        val latch = CountDownLatch(1)
        var location: Location? = null

        // First try to get the last known location if it's fresh enough
        if (maxAgeMs > 0) {
            try {
                client.lastLocation.addOnSuccessListener { loc ->
                    if (loc != null && (System.currentTimeMillis() - loc.time) <= maxAgeMs) {
                        location = loc
                    }
                    latch.countDown()
                }.addOnFailureListener {
                    latch.countDown()
                }
                latch.await(5, TimeUnit.SECONDS)
                if (location != null) {
                    return buildLocationResult(location!!, accuracyStr, cached = true)
                }
            } catch (e: SecurityException) {
                return OpResult(false, error = "LOCATION_PERMISSION_REQUIRED: ${e.message}")
            }
        }

        // Request a fresh location fix
        val freshLatch = CountDownLatch(1)
        val cts = CancellationTokenSource()
        try {
            client.getCurrentLocation(priority, cts.token)
                .addOnSuccessListener { loc -> location = loc; freshLatch.countDown() }
                .addOnFailureListener { freshLatch.countDown() }
        } catch (e: SecurityException) {
            return OpResult(false, error = "LOCATION_PERMISSION_REQUIRED: ${e.message}")
        }

        val gotFix = freshLatch.await(15, TimeUnit.SECONDS)
        cts.cancel()

        if (!gotFix || location == null) {
            // Fall back to last known
            val fallbackLatch = CountDownLatch(1)
            try {
                client.lastLocation.addOnSuccessListener { loc -> location = loc; fallbackLatch.countDown() }
                    .addOnFailureListener { fallbackLatch.countDown() }
                fallbackLatch.await(5, TimeUnit.SECONDS)
            } catch (_: SecurityException) {}
        }

        return if (location != null) {
            buildLocationResult(location!!, accuracyStr, cached = false)
        } else {
            OpResult(
                false,
                error = "Could not obtain a GPS fix. Make sure location is enabled on the device and the Jarvis app has been granted location permission. " +
                    "On some devices, location services must be turned on in Quick Settings."
            )
        }
    }

    private fun buildLocationResult(loc: Location, accuracy: String, cached: Boolean): OpResult {
        DaemonLog.add("location_get: lat=${loc.latitude} lng=${loc.longitude} acc=${loc.accuracy}m cached=$cached")
        return OpResult(
            true,
            data = JSONObject()
                .put("latitude", loc.latitude)
                .put("longitude", loc.longitude)
                .put("accuracy", loc.accuracy)
                .put("altitude", if (loc.hasAltitude()) loc.altitude else JSONObject.NULL)
                .put("bearing", if (loc.hasBearing()) loc.bearing else JSONObject.NULL)
                .put("speed", if (loc.hasSpeed()) loc.speed else JSONObject.NULL)
                .put("provider", loc.provider ?: "unknown")
                .put("timestampMs", loc.time)
                .put("cachedFix", cached)
                .put("requestedAccuracy", accuracy)
        )
    }

    // ── android_sms_send ──────────────────────────────────────────────────────

    private fun handleSmsSend(context: Context, op: JSONObject): OpResult {
        val to = op.optString("to").ifEmpty {
            return OpResult(false, error = "to (phone number) required")
        }
        val message = op.optString("message").ifEmpty {
            return OpResult(false, error = "message required")
        }

        if (context.checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            return OpResult(
                false,
                error = "SMS_PERMISSION_REQUIRED: SEND_SMS permission is not granted. " +
                    "Go to Settings → Apps → Jarvis Daemon → Permissions → SMS and enable it."
            )
        }

        // Check if the device has SMS capability (Wi-Fi-only tablets don't)
        val pm = context.packageManager
        if (!pm.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)) {
            return OpResult(
                false,
                error = "SMS_NOT_SUPPORTED: This device does not have SMS capability. " +
                    "SMS requires a device with an active SIM card and cellular connectivity."
            )
        }

        return try {
            val smsManager: SmsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                context.getSystemService(SmsManager::class.java)
            } else {
                @Suppress("DEPRECATION")
                SmsManager.getDefault()
            }
            // Split long messages automatically
            val parts = smsManager.divideMessage(message)
            if (parts.size == 1) {
                smsManager.sendTextMessage(to, null, message, null, null)
            } else {
                smsManager.sendMultipartTextMessage(to, null, parts, null, null)
            }
            DaemonLog.add("sms_send: sent to=$to parts=${parts.size}")
            OpResult(
                true,
                data = JSONObject()
                    .put("to", to)
                    .put("messageParts", parts.size)
                    .put("sent", true)
            )
        } catch (e: Exception) {
            Log.e(TAG, "handleSmsSend failed", e)
            OpResult(false, error = "SMS send failed: ${e.message}")
        }
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

    // ── Voice / Wake Word / Talk Mode ────────────────────────────────────────

    /**
     * Start (or update) the WakeWordService with the given trigger phrases.
     * Pass `enabled: false` to stop the service.
     */
    private fun handleSetWakeWords(context: Context, op: JSONObject): OpResult {
        val enabled = op.optBoolean("enabled", true)
        val talkMode = op.optBoolean("talkMode", false)
        val wordsArray = op.optJSONArray("words")
        val words: Array<String> = if (wordsArray != null) {
            Array(wordsArray.length()) { i -> wordsArray.optString(i) }.filter { it.isNotBlank() }.toTypedArray()
        } else {
            arrayOf("hey jarvis", "jarvis", "computer")
        }

        if (!enabled) {
            val stopIntent = Intent(context, WakeWordService::class.java).apply {
                action = WakeWordService.ACTION_STOP
            }
            context.stopService(stopIntent)
            DaemonLog.add("voice_set_wake_words: stopped service")
            return OpResult(true, data = JSONObject().put("status", "stopped"))
        }

        if (WakeWordService.instance != null) {
            // Already running — update words/mode without a full restart
            val updateIntent = Intent(context, WakeWordService::class.java).apply {
                action = WakeWordService.ACTION_UPDATE
                putExtra(WakeWordService.EXTRA_WAKE_WORDS, words)
                putExtra(WakeWordService.EXTRA_TALK_MODE, talkMode)
            }
            context.startService(updateIntent)
            DaemonLog.add("voice_set_wake_words: updated — words=[${words.joinToString()}] talkMode=$talkMode")
        } else {
            val startIntent = Intent(context, WakeWordService::class.java).apply {
                action = WakeWordService.ACTION_START
                putExtra(WakeWordService.EXTRA_WAKE_WORDS, words)
                putExtra(WakeWordService.EXTRA_TALK_MODE, talkMode)
            }
            context.startForegroundService(startIntent)
            DaemonLog.add("voice_set_wake_words: started — words=[${words.joinToString()}] talkMode=$talkMode")
        }

        return OpResult(
            ok = true,
            data = JSONObject()
                .put("status", "active")
                .put("words", words.toList().toString())
                .put("talkMode", talkMode)
        )
    }

    /**
     * Enable or disable Talk Mode on the running WakeWordService.
     * Talk Mode automatically re-arms the mic after each TTS response.
     */
    private fun handleSetTalkMode(context: Context, op: JSONObject): OpResult {
        val enabled = op.optBoolean("enabled", false)
        val svc = WakeWordService.instance
        return if (svc != null) {
            val updateIntent = Intent(context, WakeWordService::class.java).apply {
                action = WakeWordService.ACTION_UPDATE
                putExtra(WakeWordService.EXTRA_TALK_MODE, enabled)
            }
            context.startService(updateIntent)
            DaemonLog.add("voice_set_talk_mode: talkMode=$enabled")
            OpResult(true, data = JSONObject().put("talkMode", enabled))
        } else {
            OpResult(false, error = "Wake word service is not running — enable wake words first")
        }
    }

    /**
     * Called when TTS audio has finished playing.
     * Delegates to WakeWordService to re-arm the mic in Talk Mode.
     */
    private fun handleTtsFinished(): OpResult {
        WakeWordService.onTtsFinished()
        DaemonLog.add("voice_tts_finished: notified WakeWordService")
        return OpResult(true, data = JSONObject().put("notified", true))
    }

    /**
     * Plays a base64-encoded MP3 audio clip sent from the server as a Talk Mode response.
     * Writes to a temp file, plays via MediaPlayer, and notifies WakeWordService when done.
     */
    private fun handleSpeakAudio(context: Context, op: JSONObject): OpResult {
        val audioBase64 = op.optString("audioBase64", "")
        if (audioBase64.isEmpty()) return OpResult(false, error = "audioBase64 missing")

        return try {
            val bytes = Base64.decode(audioBase64, Base64.DEFAULT)
            val tmpFile = java.io.File(context.cacheDir, "jarvis_tts_${System.currentTimeMillis()}.mp3")
            tmpFile.writeBytes(bytes)

            // Pause the wake-word microphone so the speaker audio isn't captured
            WakeWordService.pauseForPlayback()

            val player = android.media.MediaPlayer()
            player.setDataSource(tmpFile.absolutePath)
            player.prepare()
            player.setOnCompletionListener { mp ->
                mp.release()
                tmpFile.delete()
                // Notify WakeWordService so Talk Mode can re-arm the mic
                WakeWordService.onTtsFinished()
                DaemonLog.add("voice_speak_audio: playback complete — talk mode re-armed")
            }
            player.start()
            DaemonLog.add("voice_speak_audio: playing ${bytes.size} bytes")
            OpResult(true, data = JSONObject().put("playing", true).put("bytes", bytes.size))
        } catch (e: Exception) {
            Log.e(TAG, "handleSpeakAudio failed", e)
            OpResult(false, error = e.message ?: "playback failed")
        }
    }

    // ── android_view_hierarchy ───────────────────────────────────────────────
    // Dumps the full on-screen UI element tree and returns it as a flat JSON
    // array with: resource-id, content-desc, text, bounds ([x1,y1][x2,y2]),
    // clickable, focusable, scrollable.
    //
    // Implementation note: The task spec mentions running `uiautomator dump`
    // via ADB shell, but that approach is not available from within an Android
    // app — ADB shell commands require a host-side tool or root access.
    // Traverse the AccessibilityService node tree (rootInActiveWindow) to produce
    // an equivalent of a UIAutomator view hierarchy dump. This approach requires no
    // ADB/shell access and no file system writes, works on all Android versions ≥ 5,
    // and is robust on locked-down devices that block uiautomator shell commands.
    // The JSON field names match UIAutomator XML attribute names exactly (with hyphens).
    private fun handleViewHierarchy(): OpResult {
        val svc = JarvisAccessibilityService.instance
            ?: return OpResult(false, error = "Accessibility service not running. Enable it in Settings > Accessibility > Jarvis Daemon.")

        val root = svc.rootInActiveWindow
            ?: return OpResult(false, error = "No active window found — the screen may be locked or a secure window is blocking access.")

        val elements = JSONArray()
        val rect = android.graphics.Rect()

        fun traverse(node: android.view.accessibility.AccessibilityNodeInfo?, depth: Int) {
            if (node == null || depth > 30) return
            try {
                node.getBoundsInScreen(rect)
                // Include all nodes with a non-zero area on screen (matches UIAutomator dump behaviour)
                if (rect.width() > 0 && rect.height() > 0) {
                    elements.put(
                        JSONObject()
                            .put("resource-id", node.viewIdResourceName ?: "")
                            .put("content-desc", node.contentDescription?.toString() ?: "")
                            .put("text", node.text?.toString() ?: "")
                            .put("bounds", "[${rect.left},${rect.top}][${rect.right},${rect.bottom}]")
                            .put("clickable", node.isClickable)
                            .put("focusable", node.isFocusable)
                            .put("scrollable", node.isScrollable)
                    )
                }
                for (i in 0 until node.childCount) {
                    traverse(node.getChild(i), depth + 1)
                }
            } catch (e: Exception) {
                Log.w(TAG, "viewHierarchy: node traversal error at depth $depth: ${e.message}")
            }
        }

        traverse(root, 0)
        DaemonLog.add("view_hierarchy: ${elements.length()} elements found")

        // Return the JSON array directly as the result payload so the server receives
        // a top-level array (consistent with the tool description and spec).
        return OpResult(ok = true, data = elements)
    }

    // ── android_start_training ───────────────────────────────────────────────
    // Enables training mode on the accessibility service.  The next user tap on
    // any clickable element will be captured and emitted back as a training_tap
    // event over the WebSocket.  Training mode is automatically cleared after
    // one tap, or when this op is called again with a new label.
    private fun handleStartTraining(op: JSONObject): OpResult {
        val label = op.optString("label", "button")
        val svc = JarvisAccessibilityService.instance
            ?: return OpResult(false, error = "Accessibility service not running — enable it in Settings > Accessibility > Jarvis Daemon.")

        JarvisAccessibilityService.trainingLabel = label
        JarvisAccessibilityService.trainingModeActive = true

        DaemonLog.add("training mode ON — waiting for tap (label=$label)")
        return OpResult(
            ok = true,
            data = JSONObject()
                .put("trainingActive", true)
                .put("label", label)
                .put("message", "Training mode enabled. Tap the '$label' button to record its location.")
        )
    }
}
