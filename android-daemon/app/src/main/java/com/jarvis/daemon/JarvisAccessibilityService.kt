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
    fun launchApp(packageName: String): Boolean {
        val pm = packageManager
        val intent = pm.getLaunchIntentForPackage(packageName) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e(TAG, "launchApp failed for $packageName: ${e.message}")
            false
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

    // ── Screenshot via AccessibilityService.takeScreenshot() (API 30+) ──────
    @Suppress("NewApi")
    fun takeScreenshotBase64(): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            Log.w(TAG, "Screenshot requires Android 11+")
            return null
        }
        val latch = CountDownLatch(1)
        var encoded: String? = null

        takeScreenshot(
            0, // Display.DEFAULT_DISPLAY
            mainExecutor,
            object : TakeScreenshotCallback {
                override fun onSuccess(screenshotResult: ScreenshotResult) {
                    try {
                        val bmp = screenshotResult.bitmap
                        // Hardware bitmaps cannot be compressed — copy to software config first
                        val soft = if (bmp.config == Bitmap.Config.HARDWARE) {
                            bmp.copy(Bitmap.Config.ARGB_8888, false)
                        } else {
                            bmp
                        }
                        val bos = ByteArrayOutputStream()
                        soft.compress(Bitmap.CompressFormat.PNG, 90, bos)
                        if (soft !== bmp) soft.recycle()
                        encoded = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
                    } catch (e: Exception) {
                        Log.e(TAG, "Screenshot encode failed: ${e.message}")
                    } finally {
                        latch.countDown()
                    }
                }

                override fun onFailure(errorCode: Int) {
                    Log.e(TAG, "takeScreenshot failed with code $errorCode")
                    latch.countDown()
                }
            }
        )

        latch.await(8, TimeUnit.SECONDS)
        return encoded
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
    fun typeText(text: String) {
        val focused = findFocusedEditable(rootInActiveWindow)
        if (focused != null) {
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            }
            focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        } else {
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
            "notifications" -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
        }
    }
}
