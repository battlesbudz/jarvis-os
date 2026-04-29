package com.jarvis.daemon

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ContentUris
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.annotation.RequiresApi
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class JarvisAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "JarvisA11y"
        var instance: JarvisAccessibilityService? = null
            private set

        /** Set to true by the android_start_training op; cleared after one tap is captured. */
        @Volatile var trainingModeActive: Boolean = false
        /** Human-readable label for the element being trained (used as fallback name). */
        @Volatile var trainingLabel: String = ""
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "Accessibility service connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Intercept user taps when training mode is active
        if (trainingModeActive && event != null &&
            event.eventType == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            trainingModeActive = false // consume — one tap only
            captureTrainingTap(event)
        }
    }

    private fun captureTrainingTap(event: AccessibilityEvent) {
        Thread {
            try {
                val node = event.source
                val pkg = event.packageName?.toString() ?: ""
                // Use the root window's className (the Activity class name, e.g.
                // "com.instagram.android.activity.MainTabActivity") as screen context.
                // This is more specific than packageName and correctly differentiates
                // screens within the same app package.
                val activityClass = try {
                    rootInActiveWindow?.className?.toString()?.trim()
                        ?.takeIf { it.isNotEmpty() } ?: pkg
                } catch (_: Exception) { pkg }

                val bounds = if (node != null) {
                    val r = Rect()
                    node.getBoundsInScreen(r)
                    r
                } else Rect(0, 0, 0, 0)
                val cx = (bounds.left + bounds.right) / 2
                val cy = (bounds.top + bounds.bottom) / 2

                val text = node?.text?.toString()?.trim()
                val contentDesc = node?.contentDescription?.toString()?.trim()
                val viewId = node?.viewIdResourceName?.toString()?.trim()
                val nodeClass = node?.className?.toString()?.trim()

                val label = when {
                    !text.isNullOrEmpty() -> text
                    !contentDesc.isNullOrEmpty() -> contentDesc
                    !viewId.isNullOrEmpty() -> viewId.substringAfterLast("/")
                    !nodeClass.isNullOrEmpty() -> nodeClass.substringAfterLast(".")
                    trainingLabel.isNotEmpty() -> trainingLabel
                    else -> "button"
                }

                // Take screenshot for hash storage (best-effort)
                val screenshotB64 = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    try { takeScreenshotBase64() } catch (_: Exception) { null }
                } else null

                val payload = org.json.JSONObject()
                    .put("type", "training_tap")
                    .put("x", cx)
                    .put("y", cy)
                    .put("appPackage", pkg)
                    .put("screenContext", activityClass)
                    .put("elementLabel", label)
                if (screenshotB64 != null) payload.put("screenshot", screenshotB64)

                DaemonLog.add("training_tap: ($cx,$cy) pkg=$pkg label=$label")
                WebSocketService.sendEvent(payload.toString())
            } catch (e: Exception) {
                Log.e(TAG, "captureTrainingTap failed: ${e.message}")
            }
        }.start()
    }

    override fun onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    // ── Activity launch ──────────────────────────────────────────────────────
    // IMPORTANT: These are called from a background executor thread (WebSocketService).
    // startActivity() must be dispatched to the main looper — Samsung OneUI silently
    // blocks activity starts from non-main threads even inside an AccessibilityService.
    //
    // Samsung OneUI issue: startActivity() doesn't throw even when OneUI silently
    // swallows the intent. We therefore verify the app actually came to foreground
    // by polling rootInActiveWindow.packageName for up to 3 seconds after dispatch.
    fun launchApp(packageName: String): Boolean {
        val pm = packageManager
        val intent = pm.getLaunchIntentForPackage(packageName) ?: return false
        intent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED or
            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        )
        val dispatched = postAndWaitForDispatch { startActivity(intent) }
        if (!dispatched) return false
        // Verify the target package actually came to foreground.
        // Samsung Galaxy Fold devices have longer animation transitions — use a generous timeout.
        return waitForForeground(packageName, timeoutMs = 6000)
    }

    fun browseUrl(url: String): Boolean {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
            )
        }
        // For URLs we only verify the call dispatched (any browser may open, not just one package)
        return postAndWaitForDispatch { startActivity(intent) }
    }

    // Dispatch a startActivity() to the main thread and wait up to 3 s for the call to complete.
    // Returns true only if the call completed without throwing an exception.
    private fun postAndWaitForDispatch(block: () -> Unit): Boolean {
        val latch = java.util.concurrent.CountDownLatch(1)
        var success = false
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            try {
                block()
                success = true
            } catch (e: Exception) {
                Log.e(TAG, "Activity launch failed: ${e.message}")
            } finally {
                latch.countDown()
            }
        }
        return try {
            latch.await(7, java.util.concurrent.TimeUnit.SECONDS)
            success
        } catch (e: InterruptedException) {
            false
        }
    }

    // Poll rootInActiveWindow.packageName until it matches targetPackage or timeout.
    // Returns false (not launched) if the package never comes to foreground.
    private fun waitForForeground(targetPackage: String, timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val fg = rootInActiveWindow?.packageName?.toString()
            if (fg == targetPackage) return true
            Thread.sleep(200)
        }
        Log.w(TAG, "launchApp: $targetPackage never came to foreground (Samsung block?)")
        return false
    }

    // ── Screenshot via AccessibilityService.takeScreenshot() (API 30+) ──────
    // Uses the public SDK API directly (no reflection) for reliability on
    // Samsung Android 14/15 where reflection-based approaches silently fail.
    //
    // Galaxy Z Fold 6 note: foldable phones expose two physical displays.
    // We detect the active display ID from the focused accessibility window and
    // fall back through display IDs 0 and 1 if detection fails.
    @RequiresApi(Build.VERSION_CODES.R)
    fun takeScreenshotBase64(): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            Log.w(TAG, "Screenshot requires Android 11+")
            return null
        }

        // Determine which display is currently active.
        val activeDisplayId: Int = try {
            val wins = windows
            val focused = wins?.firstOrNull { it.isFocused }
                ?: wins?.firstOrNull { it.isActive }
                ?: wins?.firstOrNull()
            focused?.displayId ?: 0
        } catch (e: Exception) {
            Log.w(TAG, "Could not determine active display, defaulting to 0: ${e.message}")
            0
        }

        val displayCandidates = (listOf(activeDisplayId) + listOf(0, 1)).distinct()
        for (displayId in displayCandidates) {
            val result = takeScreenshotForDisplay(displayId)
            if (result != null) {
                Log.i(TAG, "Screenshot succeeded on display $displayId")
                return result
            }
            Log.w(TAG, "Screenshot failed on display $displayId — trying next")
        }
        return null
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun takeScreenshotForDisplay(displayId: Int): String? {
        return try {
            val latch = CountDownLatch(1)
            var encoded: String? = null

            val callback = object : AccessibilityService.TakeScreenshotCallback {
                override fun onSuccess(result: AccessibilityService.ScreenshotResult) {
                    try {
                        // ScreenshotResult's bitmap getter is not exposed in the compile-time
                        // SDK stubs for all compileSdk versions. Use reflection to call whichever
                        // method is available at runtime: getHardwareBitmap() (API 30) or
                        // getBitmap() (API 31+). Both return android.graphics.Bitmap.
                        val rawBmp: Bitmap? = try {
                            result.javaClass.getMethod("getHardwareBitmap").invoke(result) as? Bitmap
                        } catch (_: Exception) {
                            try {
                                result.javaClass.getMethod("getBitmap").invoke(result) as? Bitmap
                            } catch (_: Exception) { null }
                        }

                        if (rawBmp == null) {
                            Log.w(TAG, "ScreenshotResult: bitmap method not found via reflection")
                            latch.countDown()
                            return
                        }

                        // Convert HARDWARE bitmap → ARGB_8888 so pixels are CPU-readable.
                        val soft = if (rawBmp.config == Bitmap.Config.HARDWARE) {
                            rawBmp.copy(Bitmap.Config.ARGB_8888, false).also { rawBmp.recycle() }
                        } else rawBmp

                        // Scale to 50% — reduces ~8 MB ARGB bitmap to ~2 MB before encoding.
                        val scaledW = (soft.width * 0.5f).toInt().coerceAtLeast(1)
                        val scaledH = (soft.height * 0.5f).toInt().coerceAtLeast(1)
                        val scaled = Bitmap.createScaledBitmap(soft, scaledW, scaledH, true)
                        if (scaled !== soft) soft.recycle()

                        val bos = ByteArrayOutputStream()
                        scaled.compress(Bitmap.CompressFormat.JPEG, 80, bos)
                        scaled.recycle()
                        encoded = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
                        Log.i(TAG, "Screenshot: ${bos.size()} bytes JPEG (display $displayId, ${scaledW}×${scaledH})")
                    } catch (oom: OutOfMemoryError) {
                        Log.e(TAG, "Screenshot OOM on display $displayId")
                    } catch (e: Exception) {
                        Log.e(TAG, "Screenshot encode error display $displayId: ${e.message}")
                    } finally {
                        latch.countDown()
                    }
                }

                override fun onFailure(errorCode: Int) {
                    // Codes: 1=UNKNOWN, 2=TIMEOUT, 3=SECURE_WINDOW_NOT_ALLOWED, 4=NOT_WHITELISTED
                    Log.w(TAG, "takeScreenshot onFailure display=$displayId code=$errorCode")
                    latch.countDown()
                }
            }

            // Dispatch takeScreenshot() to the main thread.
            // Samsung OneUI silently blocks accessibility API calls from background threads —
            // the same restriction that forced startActivity() to use postAndWaitForDispatch().
            // Without this, takeScreenshot() returns onFailure on all Samsung Android 14/15 devices
            // regardless of FLAG_SECURE status.
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                try {
                    takeScreenshot(displayId, mainExecutor, callback)
                } catch (e: Exception) {
                    Log.e(TAG, "takeScreenshot call failed on main thread: ${e.message}")
                    latch.countDown()
                }
            }

            // 4-second cap per display.
            // On Samsung, if the call wasn't dispatched to the main thread, the callback
            // never fires — so each display waits the full timeout. 4s × 3 displays = 12s,
            // safely under the server's 20s op timeout. With the main-thread dispatch fix
            // the callback fires in <500ms, so this cap is only a safety net.
            latch.await(4, TimeUnit.SECONDS)
            encoded
        } catch (oom: OutOfMemoryError) {
            Log.e(TAG, "takeScreenshotForDisplay($displayId) OOM")
            null
        } catch (e: Exception) {
            Log.e(TAG, "takeScreenshotForDisplay($displayId) exception: ${e.message}")
            null
        }
    }

    // ── Fallback screenshot via system global action + gallery read ───────────
    // When takeScreenshot() fails (FLAG_SECURE, Samsung policy, etc.), simulate
    // the hardware screenshot button and read the saved file from the gallery.
    // Samsung's screenshot service uses a different code path that can capture
    // content the accessibility API cannot.
    //
    // Strategy (most reliable first):
    // 1. MediaStore query — vendor-agnostic, works on Samsung, Pixel, OnePlus, etc.
    //    Asks Android for the most recently added image created after the pre-shot timestamp.
    // 2. Filesystem walk fallback — if MediaStore hasn't indexed yet, walk the top two
    //    levels of DCIM, Pictures, and sdcard root for any "screenshot" subdirectory.
    fun takeScreenshotViaGlobalAction(): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
        return try {
            // Record timestamp BEFORE the shot so we can filter only the new file.
            val beforeMs = System.currentTimeMillis() - 500
            val beforeSec = beforeMs / 1000L

            val fired = performGlobalAction(GLOBAL_ACTION_TAKE_SCREENSHOT)
            if (!fired) {
                Log.w(TAG, "GLOBAL_ACTION_TAKE_SCREENSHOT returned false")
                return null
            }

            // Wait for the system screenshot service to save and index the file.
            Thread.sleep(2000)

            // ── Strategy 1: MediaStore query ──────────────────────────────────────
            val mediaStoreBytes = readNewestImageFromMediaStore(beforeSec)
            if (mediaStoreBytes != null) {
                Log.i(TAG, "Global action screenshot via MediaStore: ${mediaStoreBytes.size} bytes")
                return Base64.encodeToString(mediaStoreBytes, Base64.NO_WRAP)
            }

            Log.w(TAG, "MediaStore returned nothing — trying filesystem walk fallback")

            // ── Strategy 2: Filesystem walk — top-2-level "screenshot" dirs ───────
            val imageExtensions = setOf("jpg", "jpeg", "png", "webp")
            val roots = listOf(
                android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_DCIM),
                android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_PICTURES),
                android.os.Environment.getExternalStorageDirectory()
            ).filterNotNull().map { it.absolutePath }

            val screenshotDirs = mutableListOf<java.io.File>()
            for (rootPath in roots) {
                val root = java.io.File(rootPath)
                if (!root.isDirectory) continue
                // Depth 1
                root.listFiles()?.forEach { child ->
                    if (child.isDirectory && child.name.contains("screenshot", ignoreCase = true)) {
                        screenshotDirs.add(child)
                    } else if (child.isDirectory) {
                        // Depth 2
                        child.listFiles()?.forEach { grandchild ->
                            if (grandchild.isDirectory &&
                                grandchild.name.contains("screenshot", ignoreCase = true)) {
                                screenshotDirs.add(grandchild)
                            }
                        }
                    }
                }
            }

            val latestFile = screenshotDirs
                .flatMap { dir -> dir.listFiles()?.toList() ?: emptyList() }
                .filter { f ->
                    f.isFile && f.lastModified() > beforeMs &&
                        f.extension.lowercase() in imageExtensions
                }
                .maxByOrNull { it.lastModified() }

            if (latestFile == null) {
                Log.w(TAG, "Global action screenshot: no new file found via filesystem walk")
                return null
            }

            val bytes = latestFile.readBytes()
            Log.i(TAG, "Global action screenshot via filesystem: ${bytes.size} bytes from ${latestFile.name}")
            Base64.encodeToString(bytes, Base64.NO_WRAP)
        } catch (oom: OutOfMemoryError) {
            Log.e(TAG, "takeScreenshotViaGlobalAction OOM")
            null
        } catch (e: Exception) {
            Log.e(TAG, "takeScreenshotViaGlobalAction exception: ${e.message}")
            null
        }
    }

    // Query MediaStore for the most recently added image created after `afterSec` (epoch seconds).
    // Returns the raw bytes of the file, or null if nothing is found.
    private fun readNewestImageFromMediaStore(afterSec: Long): ByteArray? {
        return try {
            val projection = arrayOf(
                MediaStore.Images.Media._ID,
                MediaStore.Images.Media.DATE_ADDED,
                MediaStore.Images.Media.DISPLAY_NAME
            )
            val selection = "${MediaStore.Images.Media.DATE_ADDED} >= ?"
            val selectionArgs = arrayOf(afterSec.toString())
            val sortOrder = "${MediaStore.Images.Media.DATE_ADDED} DESC"
            val uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI

            contentResolver.query(uri, projection, selection, selectionArgs, sortOrder)?.use { cursor ->
                if (!cursor.moveToFirst()) return null
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val id = cursor.getLong(idCol)
                val contentUri = ContentUris.withAppendedId(uri, id)
                contentResolver.openInputStream(contentUri)?.use { it.readBytes() }
            }
        } catch (e: Exception) {
            Log.w(TAG, "MediaStore query failed: ${e.message}")
            null
        }
    }

    // ── Read screen — returns compact JSON ──────────────────────────────────
    fun readScreenContent(): String {
        val root = rootInActiveWindow
        val packageName = root?.packageName?.toString() ?: ""

        val texts = mutableListOf<String>()
        val clickableArr = JSONArray()
        if (root != null) collectNodes(root, texts, clickableArr, 0)

        val textArr = JSONArray()
        for (t in texts) textArr.put(t)

        return JSONObject()
            .put("package", packageName)
            .put("activity", packageName)
            .put("text", textArr)
            .put("clickable", clickableArr)
            .toString()
    }

    private fun collectNodes(
        node: AccessibilityNodeInfo?,
        texts: MutableList<String>,
        clickable: JSONArray,
        depth: Int
    ) {
        if (node == null || depth > 25) return
        val text = node.text?.toString()?.trim()
        val desc = node.contentDescription?.toString()?.trim()

        val label = when {
            !text.isNullOrEmpty() -> text
            !desc.isNullOrEmpty() -> desc
            else -> null
        }
        if (label != null && label.length > 1 && !texts.contains(label)) {
            texts.add(label)
        }
        val resourceId = node.viewIdResourceName?.toString()?.trim() ?: ""
        val className = node.className?.toString()?.trim() ?: ""
        if (node.isClickable && (label != null || resourceId.isNotEmpty() || className.isNotEmpty())) {
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            val obj = JSONObject()
                .put("label", label ?: "")
                .put("x", bounds.centerX())
                .put("y", bounds.centerY())
                .put("resource_id", resourceId)
                .put("content_desc", desc ?: "")
                .put("class_name", className)
            clickable.put(obj)
        }
        for (i in 0 until node.childCount) {
            collectNodes(node.getChild(i), texts, clickable, depth + 1)
        }
    }

    // ── Tap ─────────────────────────────────────────────────────────────────
    fun performTap(x: Float, y: Float) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            Log.w(TAG, "Gestures require Android 7+")
            return
        }
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 100)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        dispatchGesture(gesture, null, null)
    }

    // ── Type ─────────────────────────────────────────────────────────────────
    //
    // ACTION_IME_ENTER: public in API 33 ext5+, reflected with fallback for older APIs.
    // PhoneClaw pattern: https://github.com/rohanarun/phoneclaw
    private val actionImeEnterCompat: Int by lazy {
        try {
            AccessibilityNodeInfo::class.java.getField("ACTION_IME_ENTER").getInt(null)
        } catch (_: Throwable) {
            0x00002000  // Internal bit flag — consistent across AOSP since API 16
        }
    }

    /** Type text into the currently-focused editable field.
     *  @param submit If true, send IME action (Search/Go/Enter) after typing. */
    fun typeText(text: String, submit: Boolean = false): Boolean {
        val focused = findFocusedEditable(rootInActiveWindow)
            ?: findFirstEditable(rootInActiveWindow)

        if (focused == null) {
            Log.w(TAG, "typeText: no editable field found")
            return false
        }

        // Set text
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        val ok = focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)

        // Optional IME submit (Search/Go/Enter key on keyboard)
        if (submit && ok) {
            Thread.sleep(80)  // Give IME time to react
            focused.performAction(actionImeEnterCompat)
        }

        return ok
    }

    /** Press the IME action key (Search/Go/Done/Enter) on the currently focused field. */
    fun pressImeAction(): Boolean {
        val focused = findFocusedEditable(rootInActiveWindow) ?: return false
        return focused.performAction(actionImeEnterCompat)
    }

    data class ClearFieldResult(
        val cleared: Boolean,
        val method: String,
        val fieldWasAlreadyEmpty: Boolean,
        val verifiedEmpty: Boolean,
        val error: String? = null
    )

    /**
     * Clear all text from the currently-focused editable field.
     *
     * Step 1 (primary) — ACTION_SET_TEXT("") via accessibility.
     *   Works for standard EditText and most native views.
     *   Verified by refreshing the node and reading text back.
     *
     * Step 2 (fallback) — ACTION_SET_SELECTION(0, len) then ACTION_SET_TEXT("").
     *   Selects all text and overwrites the selection with an empty string.
     *   Avoids clipboard side-effects from ACTION_CUT.
     *   Falls back to ACTION_CUT only if the overwrite attempt fails.
     *   Uses exact currentLength bound (no +1) so selection is within text range.
     *   Verified by node refresh.
     *
     * Step 3 (fallback) — re-find node from a fresh window traversal,
     *   then retry ACTION_SET_TEXT("") on the fresh reference.
     *   Covers the case where the original node reference went stale, and the
     *   case where the focused node changed (e.g., some input views recreate
     *   their node when the IME opens).
     *   Verified by node refresh.
     *
     * Step 4 (final fallback) — adb-style keyevent CTRL_A + DEL via Runtime.exec.
     *   Simulates hardware key injection: select-all (Ctrl+A) followed by delete.
     *   Works on WebViews, React Native text inputs, and custom keyboard apps that
     *   ignore accessibility actions but respond to raw key injection.
     *   KEYCODE_CTRL_LEFT=113, KEYCODE_A=29, KEYCODE_DEL=67.
     *   Verified by fresh node refresh after the keyevent sequence.
     */
    fun clearField(): ClearFieldResult {
        val root = rootInActiveWindow
        val focused = findFocusedEditable(root) ?: findFirstEditable(root)
            ?: return ClearFieldResult(false, "none", false, false, "No editable field found — tap a text input first")

        // Check if the field already has content to clear.
        // Only skip clearing if we can positively confirm the text is empty (not null).
        // focused.text is null on password/obfuscated fields — in that case proceed with
        // the clear attempt rather than assuming empty.
        val initialText = focused.text?.toString()
        if (initialText != null && initialText.isEmpty()) {
            return ClearFieldResult(true, "already_empty", true, true)
        }

        // ── Step 1: ACTION_SET_TEXT("") ──────────────────────────────────────
        val setTextArgs = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "")
        }
        val setTextOk = focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, setTextArgs)

        if (setTextOk) {
            Thread.sleep(80)
            focused.refresh()
            val textAfterRaw = focused.text  // null = unreadable (password/obfuscated field)
            val textAfterStr = textAfterRaw?.toString()
            when {
                textAfterStr == null -> {
                    // Can't read text (protected field) — trust ACTION_SET_TEXT return value,
                    // but flag that we could not verify independently.
                    return ClearFieldResult(true, "ACTION_SET_TEXT", false, false)
                }
                textAfterStr.isEmpty() -> {
                    return ClearFieldResult(true, "ACTION_SET_TEXT", false, true)
                }
                else -> {
                    Log.w(TAG, "clearField: ACTION_SET_TEXT returned ok but text remains — trying select+cut")
                }
            }
        }

        // ── Step 2: Select all + overwrite with empty string ─────────────────
        // Primary: ACTION_SET_SELECTION(0..len) then ACTION_SET_TEXT("").
        // Selects all text and overwrites the selection with "" — no clipboard side-effects.
        // Fallback within step: if set-text after selection fails, try ACTION_CUT instead.
        // Use currentLength (not +1) to stay within valid selection bounds.
        // For password/null-text fields use Int.MAX_VALUE — the system clamps it.
        focused.refresh()
        val currentLength = focused.text?.length ?: (initialText?.length ?: Int.MAX_VALUE)

        val selArgs = Bundle().apply {
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, 0)
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, currentLength)
        }
        val selOk = focused.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, selArgs)

        if (selOk) {
            Thread.sleep(60)
            // Preferred: overwrite selection with "" (no clipboard side-effects)
            val deleteArgs = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "")
            }
            val deleteOk = focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, deleteArgs)
            Thread.sleep(80)
            focused.refresh()
            val textAfterDeleteRaw = focused.text
            val textAfterDeleteStr = textAfterDeleteRaw?.toString()
            when {
                textAfterDeleteStr == null && deleteOk -> {
                    // Protected field — trust the performAction return value
                    return ClearFieldResult(true, "ACTION_SET_SELECTION_DELETE", false, false)
                }
                textAfterDeleteStr != null && textAfterDeleteStr.isEmpty() -> {
                    return ClearFieldResult(true, "ACTION_SET_SELECTION_DELETE", false, true)
                }
                else -> {
                    // Overwrite didn't take — fall back to ACTION_CUT as last resort for this step
                    Log.w(TAG, "clearField: set-text after selection failed — trying ACTION_CUT fallback")
                    val cutOk = focused.performAction(AccessibilityNodeInfo.ACTION_CUT)
                    Thread.sleep(80)
                    focused.refresh()
                    val textAfterCutRaw = focused.text
                    val textAfterCutStr = textAfterCutRaw?.toString()
                    when {
                        textAfterCutStr == null -> {
                            if (cutOk) return ClearFieldResult(true, "ACTION_SET_SELECTION_CUT", false, false)
                            Log.w(TAG, "clearField: ACTION_CUT failed on protected field")
                        }
                        textAfterCutStr.isEmpty() -> {
                            return ClearFieldResult(true, "ACTION_SET_SELECTION_CUT", false, true)
                        }
                        else -> {
                            Log.w(TAG, "clearField: ACTION_CUT did not fully clear — remaining='${textAfterCutStr.take(20)}' cutOk=$cutOk")
                        }
                    }
                }
            }
        } else {
            Log.w(TAG, "clearField: ACTION_SET_SELECTION failed — node may not support selection")
        }

        // ── Step 3: Fresh node reference + retry ACTION_SET_TEXT("") ─────────
        // The original `focused` reference may have become stale if the IME
        // caused the view hierarchy to rebuild.  Re-traverse from the root.
        Thread.sleep(100)
        val freshRoot = rootInActiveWindow
        val freshNode = findFocusedEditable(freshRoot) ?: findFirstEditable(freshRoot)
        if (freshNode != null) {
            val freshArgs = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "")
            }
            val freshOk = freshNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, freshArgs)
            if (freshOk) {
                Thread.sleep(80)
                freshNode.refresh()
                val textAfterFreshRaw = freshNode.text
                val textAfterFreshStr = textAfterFreshRaw?.toString()
                when {
                    textAfterFreshStr == null -> {
                        // Protected field — trust ACTION_SET_TEXT return value
                        return ClearFieldResult(true, "ACTION_SET_TEXT_fresh_node", false, false)
                    }
                    textAfterFreshStr.isEmpty() -> {
                        return ClearFieldResult(true, "ACTION_SET_TEXT_fresh_node", false, true)
                    }
                    else -> {
                        Log.w(TAG, "clearField: fresh ACTION_SET_TEXT also failed — remaining='${textAfterFreshStr.take(20)}'")
                    }
                }
            }
        }

        // ── Step 4: adb keyevent CTRL_A + DEL (hardware key injection) ───────
        // Works on WebViews, React Native inputs, and custom-IME fields that
        // ignore accessibility actions but respond to raw key injection.
        // input keyevent: KEYCODE_CTRL_LEFT=113, KEYCODE_A=29, KEYCODE_DEL=67.
        Thread.sleep(100)
        try {
            // Step 4a: Select all via Ctrl+A chord
            val ctrlAProc = Runtime.getRuntime().exec(
                arrayOf("input", "keyevent", "--longpress", "113", "29")
            )
            val ctrlAExited = ctrlAProc.waitFor(3, TimeUnit.SECONDS)
            if (ctrlAExited && ctrlAProc.exitValue() == 0) {
                Thread.sleep(80)
                // Step 4b: Delete the selected text
                val delProc = Runtime.getRuntime().exec(arrayOf("input", "keyevent", "67"))
                val delExited = delProc.waitFor(3, TimeUnit.SECONDS)
                if (delExited && delProc.exitValue() == 0) {
                    Thread.sleep(80)
                    val verifyRoot = rootInActiveWindow
                    val verifyNode = findFocusedEditable(verifyRoot) ?: findFirstEditable(verifyRoot)
                    if (verifyNode != null) {
                        verifyNode.refresh()
                        val textAfterKey = verifyNode.text?.toString()
                        when {
                            textAfterKey == null -> {
                                // Protected field — trust the keyevent exit codes
                                return ClearFieldResult(true, "keyevent_ctrl_a_del", false, false)
                            }
                            textAfterKey.isEmpty() -> {
                                return ClearFieldResult(true, "keyevent_ctrl_a_del", false, true)
                            }
                            else -> {
                                Log.w(TAG, "clearField: keyevent CTRL_A+DEL did not clear — remaining='${textAfterKey.take(20)}'")
                            }
                        }
                    } else {
                        // No node to verify; trust the exit codes
                        return ClearFieldResult(true, "keyevent_ctrl_a_del", false, false)
                    }
                } else {
                    Log.w(TAG, "clearField: keyevent DEL failed — exit=${if (delExited) delProc.exitValue() else -1}")
                }
            } else {
                Log.w(TAG, "clearField: keyevent CTRL_A failed — exit=${if (ctrlAExited) ctrlAProc.exitValue() else -1}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "clearField: keyevent CTRL_A+DEL exception: ${e.message}")
        }

        return ClearFieldResult(
            false, "all_methods_failed", false, false,
            "Could not clear field — ACTION_SET_TEXT, select+delete, select+cut, fresh-node retry, and keyevent CTRL_A+DEL all failed. " +
                "This field type may not support any accessibility-based text clearing."
        )
    }

    private fun findFocusedEditable(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isEditable && node.isFocused) return node
        for (i in 0 until node.childCount) {
            val result = findFocusedEditable(node.getChild(i))
            if (result != null) return result
        }
        return null
    }

    private fun findFirstEditable(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isEditable) return node
        for (i in 0 until node.childCount) {
            val result = findFirstEditable(node.getChild(i))
            if (result != null) return result
        }
        return null
    }

    // ── Focused field info — for android_get_focused_field ───────────────────
    data class FocusedFieldInfo(
        val focused: Boolean,
        val text: String?,
        val hint: String?,
        val resourceId: String?,
        val className: String?,
        val isPassword: Boolean
    )

    fun getFocusedFieldInfo(): FocusedFieldInfo {
        val root = rootInActiveWindow
            ?: return FocusedFieldInfo(false, null, null, null, null, false)
        val node = findFocusedEditable(root)
            ?: return FocusedFieldInfo(false, null, null, null, null, false)
        val hint = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            node.hintText?.toString()
        } else null
        return FocusedFieldInfo(
            focused = true,
            text = node.text?.toString(),
            hint = hint,
            resourceId = node.viewIdResourceName,
            className = node.className?.toString(),
            isPassword = node.isPassword
        )
    }

    // ── Paste text via clipboard + ACTION_PASTE ──────────────────────────────
    /** Copy [text] to the system clipboard and issue ACTION_PASTE on the
     *  focused (or first) editable field.  Returns true when ACTION_PASTE
     *  was accepted by the field node. */
    fun pasteFromClipboard(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val node = findFocusedEditable(root) ?: findFirstEditable(root) ?: return false

        // Build a plain-text clip and set it on the primary clipboard slot.
        // We must dispatch this to the main thread on Android 10+ — background
        // threads cannot write to the clipboard on Android 10+ (the write is
        // silently dropped).
        val latch = CountDownLatch(1)
        var clipSet = false
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            try {
                val cm = getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                val clip = android.content.ClipData.newPlainText("jarvis_input", text)
                cm.setPrimaryClip(clip)
                clipSet = true
            } catch (e: Exception) {
                Log.w(TAG, "pasteFromClipboard: clipboard set failed: ${e.message}")
            } finally {
                latch.countDown()
            }
        }
        latch.await(2, TimeUnit.SECONDS)
        if (!clipSet) return false

        Thread.sleep(100) // Let clipboard propagate
        return node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
    }

    // ── Swipe ────────────────────────────────────────────────────────────────
    fun performSwipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceIn(50, 3000))
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        dispatchGesture(gesture, null, null)
    }

    // ── Key press ────────────────────────────────────────────────────────────
    fun pressKey(key: String) {
        when (key) {
            "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "notifications" -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
            "enter" -> pressImeAction()
        }
    }
}
