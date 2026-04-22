package com.jarvis.daemon

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

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

    // ── Activity launch (exempt from Android background restriction) ─────────
    // Accessibility services are exempt from Android 10+ background activity
    // start restrictions. Calling startActivity from this context works even
    // when the app is in the background.

    fun launchApp(packageName: String): Boolean {
        val pm = packageManager
        val intent = pm.getLaunchIntentForPackage(packageName) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(intent)
            return true
        } catch (e: Exception) {
            Log.e(TAG, "launchApp failed for $packageName: ${e.message}")
            return false
        }
    }

    fun browseUrl(url: String): Boolean {
        return try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e(TAG, "browseUrl failed for $url: ${e.message}")
            false
        }
    }

    // ── Screenshot ──────────────────────────────────────────────────────────

    // Screenshot capture stubbed out — screen reading (readScreenContent) and
    // gesture control are the primary daemon features used by Jarvis.
    fun takeScreenshotBase64(): String? {
        Log.i(TAG, "Screenshot capture not available in this build")
        return null
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
