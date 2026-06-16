package com.gameplan.daemon

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.util.Base64
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Handles android_screen_record ops via the MediaProjection API.
 *
 * MediaProjection requires a one-time user-grant prompt that can only be shown
 * from a foreground Activity. We manage the grant token via ScreenCaptureSession,
 * which is obtained in MainActivity when the user grants permission, and stored
 * as a static reference here.
 *
 * If no grant has been issued yet (first use or permission revoked), we return
 * SCREEN_RECORD_PERMISSION_REQUIRED. The unified app does not expose a
 * media-projection grant flow yet, so callers should treat this as unavailable.
 *
 * Duration is clamped to 60 seconds.
 */
object ScreenRecordHandler {

    private const val TAG = "JarvisScreenRec"

    @Volatile var projectionIntent: Intent? = null

    /** Returns true if this process is currently in the foreground service / foreground importance tier. */
    private fun isForeground(context: Context): Boolean {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val processes = am.runningAppProcesses ?: return false
        val pid = android.os.Process.myPid()
        return processes.any { it.pid == pid && it.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE }
    }

    fun handleScreenRecord(context: Context, op: JSONObject): OpResult {
        val durationMs = op.optLong("durationMs", 10_000L).coerceIn(1_000L, 60_000L)
        val fps = op.optInt("fps", 15).coerceIn(5, 60)
        val audio = op.optBoolean("audio", false)

        if (!isForeground(context)) {
            return OpResult(false, error = "FOREGROUND_REQUIRED: Screen recording requires Jarvis OS to be in the foreground. Open Jarvis OS and try again.")
        }

        val captureIntent = projectionIntent
        if (captureIntent == null) {
            return OpResult(
                false,
                error = "SCREEN_RECORD_PERMISSION_REQUIRED: Screen recording requires a one-time permission from Android. " +
                    "The unified Jarvis OS app does not expose that grant flow yet."
            )
        }

        val mpm = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val projection: MediaProjection
        try {
            @Suppress("DEPRECATION")
            projection = mpm.getMediaProjection(android.app.Activity.RESULT_OK, captureIntent)
                ?: return OpResult(false, error = "SCREEN_RECORD_PERMISSION_REQUIRED: Screen capture permission expired. The unified Jarvis OS app does not expose a re-grant flow yet.")
        } catch (e: Exception) {
            projectionIntent = null
            return OpResult(
                false,
                error = "Screen recording setup failed: ${e.message}. The unified Jarvis OS app does not expose a screen-capture grant flow yet."
            )
        }

        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getMetrics(metrics)

        val screenWidth = (metrics.widthPixels / 2).let { if (it % 2 == 0) it else it - 1 }
        val screenHeight = (metrics.heightPixels / 2).let { if (it % 2 == 0) it else it - 1 }
        val screenDpi = metrics.densityDpi

        val outFile = File(context.cacheDir, "jarvis_screen_${System.currentTimeMillis()}.mp4")
        val recorder = MediaRecorder()

        if (audio) recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
        recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE)
        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        if (audio) recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
        recorder.setVideoSize(screenWidth, screenHeight)
        recorder.setVideoFrameRate(fps)
        recorder.setVideoEncodingBitRate(1_500_000)
        recorder.setOutputFile(outFile.absolutePath)
        recorder.setMaxDuration(durationMs.toInt())
        recorder.prepare()

        val doneLatch = CountDownLatch(1)
        recorder.setOnInfoListener { _, what, _ ->
            if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) {
                doneLatch.countDown()
            }
        }

        var virtualDisplay: VirtualDisplay? = null
        try {
            val surface = recorder.surface
            virtualDisplay = projection.createVirtualDisplay(
                "JarvisCapture",
                screenWidth, screenHeight, screenDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                surface, null, null
            )
            recorder.start()
            DaemonLog.add("screen_record: started ${durationMs}ms fps=$fps audio=$audio")
        } catch (e: Exception) {
            try { recorder.release() } catch (_: Exception) {}
            projection.stop()
            outFile.delete()
            return OpResult(false, error = "Screen recording start failed: ${e.message}")
        }

        val waited = doneLatch.await(durationMs + 15_000L, TimeUnit.MILLISECONDS)
        if (!waited) {
            try { recorder.stop() } catch (_: Exception) {}
        }
        try { recorder.release() } catch (_: Exception) {}
        try { virtualDisplay?.release() } catch (_: Exception) {}
        try { projection.stop() } catch (_: Exception) {}

        return if (outFile.exists() && outFile.length() > 0) {
            val bytes = outFile.readBytes()
            outFile.delete()
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            DaemonLog.add("screen_record: done ${bytes.size} bytes")
            OpResult(
                true,
                data = JSONObject()
                    .put("video", b64)
                    .put("format", "mp4")
                    .put("durationMs", durationMs)
                    .put("fps", fps)
                    .put("bytes", bytes.size)
            )
        } else {
            outFile.delete()
            OpResult(false, error = "Screen recording produced no output — try again with the app in the foreground.")
        }
    }
}
