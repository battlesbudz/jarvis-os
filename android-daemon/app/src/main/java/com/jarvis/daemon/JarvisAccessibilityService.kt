package com.jarvis.daemon

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
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
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "Accessibility service connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) { /* not needed for op-driven control */ }

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
    fun launchApp(packageName: String): Boolean {
        val pm = packageManager
        val intent = pm.getLaunchIntentForPackage(packageName) ?: return false
        intent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED or
            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        )
        return postAndWaitForLaunch { startActivity(intent) }
    }

    fun browseUrl(url: String): Boolean {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
            )
        }
        return postAndWaitForLaunch { startActivity(intent) }
    }

    // Dispatch a startActivity() call to the main thread and wait up to 3 s for it.
    // Returns true only if the call completed without throwing.
    private fun postAndWaitForLaunch(block: () -> Unit): Boolean {
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
            latch.await(3, java.util.concurrent.TimeUnit.SECONDS)
            success
        } catch (e: InterruptedException) {
            false
        }
    }

    // ── Screenshot via AccessibilityService.takeScreenshot() (API 30+) ──────
    // Uses reflection throughout to avoid compile-time dependency on the
    // TakeScreenshotCallback / ScreenshotResult nested types (their exact
    // method names vary by SDK version and are unavailable at compile time).
    fun takeScreenshotBase64(): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            Log.w(TAG, "Screenshot requires Android 11+")
            return null
        }
        return try {
            val latch = CountDownLatch(1)
            var encoded: String? = null

            val callbackClass = Class.forName(
                "android.accessibilityservice.AccessibilityService\$TakeScreenshotCallback"
            )
            val handler = java.lang.reflect.InvocationHandler { _, method, args ->
                when (method.name) {
                    "onSuccess" -> {
                        try {
                            val result = if (args != null && args.isNotEmpty()) args[0] else null
                            if (result != null) {
                                // Discover the bitmap getter at runtime (getBitmap or getHardwareBitmap)
                                val bmp = result.javaClass.methods
                                    .firstOrNull { m ->
                                        m.parameterCount == 0 &&
                                        Bitmap::class.java.isAssignableFrom(m.returnType)
                                    }
                                    ?.invoke(result) as? Bitmap
                                if (bmp != null) {
                                    val soft = if (bmp.config == Bitmap.Config.HARDWARE) {
                                        bmp.copy(Bitmap.Config.ARGB_8888, false).also { bmp.recycle() }
                                    } else bmp
                                    val bos = ByteArrayOutputStream()
                                    soft.compress(Bitmap.CompressFormat.PNG, 90, bos)
                                    soft.recycle()
                                    encoded = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
                                }
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "Screenshot encode failed: ${e.message}")
                        } finally {
                            latch.countDown()
                        }
                    }
                    "onFailure" -> {
                        val code = if (args != null && args.isNotEmpty()) args[0] else "?"
                        Log.e(TAG, "takeScreenshot failed, code=$code")
                        latch.countDown()
                    }
                }
                null
            }
            val callback = java.lang.reflect.Proxy.newProxyInstance(
                callbackClass.classLoader, arrayOf(callbackClass), handler
            )

            val takeMethod = AccessibilityService::class.java.getMethod(
                "takeScreenshot", Int::class.java,
                java.util.concurrent.Executor::class.java, callbackClass
            )
            takeMethod.invoke(this, 0, mainExecutor, callback)
            latch.await(8, TimeUnit.SECONDS)
            encoded
        } catch (e: Exception) {
            Log.e(TAG, "takeScreenshotBase64 failed: ${e.message}")
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
        if (node.isClickable && label != null) {
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            clickable.put(
                JSONObject()
                    .put("label", label)
                    .put("x", bounds.centerX())
                    .put("y", bounds.centerY())
            )
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
        }
    }
}
