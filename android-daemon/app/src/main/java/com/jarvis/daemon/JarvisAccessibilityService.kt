package com.jarvis.daemon

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.PixelFormat
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.annotation.RequiresApi
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

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

    // ── Screenshot ──────────────────────────────────────────────────────────

    // AccessibilityService.takeScreenshot() was added in Android 11 (API 30).
    // The API 28 annotation was incorrect — raise both annotation and runtime guard to API 30.
    @RequiresApi(Build.VERSION_CODES.R)
    fun takeScreenshotBase64(): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return null
        }
        val latch = CountDownLatch(1)
        val resultRef = AtomicReference<Bitmap?>(null)

        takeScreenshot(
            android.view.Display.DEFAULT_DISPLAY,
            mainExecutor,
            object : TakeScreenshotCallback {
                override fun onSuccess(screenshotResult: ScreenshotResult) {
                    val hardwareBitmap = screenshotResult.hardwareBitmap
                    val softBitmap = hardwareBitmap.copy(Bitmap.Config.ARGB_8888, false)
                    hardwareBitmap.recycle()
                    resultRef.set(softBitmap)
                    latch.countDown()
                }
                override fun onFailure(errorCode: Int) {
                    Log.e(TAG, "Screenshot failed: errorCode=$errorCode")
                    latch.countDown()
                }
            }
        )

        latch.await(5, TimeUnit.SECONDS)
        val bitmap = resultRef.get() ?: return null
        return try {
            val baos = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 90, baos)
            bitmap.recycle()
            Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.e(TAG, "Bitmap encode failed", e)
            null
        }
    }

    // ── Read screen ──────────────────────────────────────────────────────────

    fun readScreenContent(): String {
        val root = rootInActiveWindow ?: return "[screen unavailable — accessibility not connected]"
        val sb = StringBuilder()
        traverseNode(root, sb, 0)
        return sb.toString().take(12000)
    }

    private fun traverseNode(node: AccessibilityNodeInfo?, sb: StringBuilder, depth: Int) {
        if (node == null || depth > 20) return
        val indent = "  ".repeat(depth)
        val className = node.className?.toString()?.substringAfterLast('.') ?: "View"
        val text = node.text?.toString()?.trim()
        val contentDesc = node.contentDescription?.toString()?.trim()
        val hint = node.hintText?.toString()?.trim()
        val isClickable = node.isClickable
        val isEditable = node.isEditable
        val isFocused = node.isFocused

        val info = buildString {
            append(indent)
            append("[$className")
            if (isClickable) append(" clickable")
            if (isEditable) append(" editable")
            if (isFocused) append(" focused")
            append("]")
            if (!text.isNullOrEmpty()) append(" text=\"$text\"")
            if (!contentDesc.isNullOrEmpty() && contentDesc != text) append(" desc=\"$contentDesc\"")
            if (!hint.isNullOrEmpty()) append(" hint=\"$hint\"")
            val bounds = android.graphics.Rect()
            node.getBoundsInScreen(bounds)
            append(" bounds=(${bounds.left},${bounds.top},${bounds.right},${bounds.bottom})")
        }
        sb.appendLine(info)

        for (i in 0 until node.childCount) {
            traverseNode(node.getChild(i), sb, depth + 1)
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

    fun typeText(text: String) {
        val focused = findFocusedEditable(rootInActiveWindow)
        if (focused != null) {
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            }
            focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        } else {
            // Fallback: paste text via clipboard
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            }
            rootInActiveWindow?.performAction(AccessibilityNodeInfo.ACTION_PASTE, args)
        }
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
            "volume_up" -> { /* handled via AudioManager if needed */ }
            "volume_down" -> { /* handled via AudioManager if needed */ }
        }
    }
}
