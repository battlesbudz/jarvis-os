package com.gameplan.daemon

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.TotalCaptureResult
import android.media.ImageReader
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Handles camera snap (JPEG photo) and camera clip (MP4 video) ops.
 *
 * Uses Camera2 API directly — no CameraX dependency needed, avoiding build.gradle changes.
 * Both ops require CAMERA permission; audio clip also requires RECORD_AUDIO.
 * Both ops return FOREGROUND_REQUIRED if the accessibility service is not in the foreground
 * (camera2 + media recorder require an active foreground context on Android 10+).
 */
object CameraHandler {

    private const val TAG = "JarvisCam"

    /**
     * Returns true if this process is currently in the foreground (IMPORTANCE_FOREGROUND or better).
     * Used as an explicit pre-check before Camera2 and MediaProjection ops to surface
     * FOREGROUND_REQUIRED before attempting hardware capture that may silently fail in background.
     */
    fun isForeground(context: Context): Boolean {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val processes = am.runningAppProcesses ?: return false
        val pid = android.os.Process.myPid()
        return processes.any { it.pid == pid && it.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE }
    }

    fun handleSnap(context: Context, op: JSONObject): OpResult {
        if (!isForeground(context)) {
            return OpResult(false, error = "FOREGROUND_REQUIRED: Camera capture requires the Jarvis app app to be in the foreground. Open the Jarvis app app and try again.")
        }
        if (!hasPermission(context, Manifest.permission.CAMERA)) {
            return OpResult(
                false,
                error = "CAMERA_PERMISSION_REQUIRED: Jarvis cannot access the camera. " +
                    "Open the Jarvis app app, tap 'Grant Camera', or go to Settings → Apps → Jarvis app → Permissions → Camera and enable it."
            )
        }

        val facingStr = op.optString("facing", "back").lowercase()

        // "both" mode — capture front and back cameras and return both images
        if (facingStr == "both") {
            return try {
                val backBytes = captureJpeg(context, CameraCharacteristics.LENS_FACING_BACK)
                val frontBytes = captureJpeg(context, CameraCharacteristics.LENS_FACING_FRONT)
                if (backBytes == null && frontBytes == null) {
                    return OpResult(false, error = "FOREGROUND_REQUIRED: Both cameras failed to capture. Bring the Jarvis app to the foreground and try again.")
                }
                val data = JSONObject().put("format", "jpeg").put("facing", "both")
                if (backBytes != null) data.put("back", Base64.encodeToString(backBytes, Base64.NO_WRAP)).put("backBytes", backBytes.size)
                if (frontBytes != null) data.put("front", Base64.encodeToString(frontBytes, Base64.NO_WRAP)).put("frontBytes", frontBytes.size)
                DaemonLog.add("camera_snap(both): back=${backBytes?.size ?: 0}B front=${frontBytes?.size ?: 0}B")
                OpResult(true, data = data)
            } catch (e: Exception) {
                Log.e(TAG, "handleSnap(both) failed", e)
                OpResult(false, error = "Camera snap (both) failed: ${e.message}")
            }
        }

        val lensFacing = if (facingStr == "front") CameraCharacteristics.LENS_FACING_FRONT
        else CameraCharacteristics.LENS_FACING_BACK

        return try {
            val jpegBytes = captureJpeg(context, lensFacing)
                ?: return OpResult(
                    false,
                    error = "FOREGROUND_REQUIRED: Camera capture failed — bring the Jarvis app to the foreground and try again. " +
                        "Some devices block camera access when the app is in the background."
                )
            val b64 = Base64.encodeToString(jpegBytes, Base64.NO_WRAP)
            DaemonLog.add("camera_snap: captured ${jpegBytes.size} bytes JPEG facing=$facingStr")
            OpResult(
                true,
                data = JSONObject()
                    .put("image", b64)
                    .put("format", "jpeg")
                    .put("facing", facingStr)
                    .put("bytes", jpegBytes.size)
            )
        } catch (e: Exception) {
            Log.e(TAG, "handleSnap failed", e)
            OpResult(false, error = "Camera snap failed: ${e.message}")
        }
    }

    fun handleClip(context: Context, op: JSONObject): OpResult {
        if (!isForeground(context)) {
            return OpResult(false, error = "FOREGROUND_REQUIRED: Video recording requires the Jarvis app app to be in the foreground. Open the Jarvis app app and try again.")
        }
        if (!hasPermission(context, Manifest.permission.CAMERA)) {
            return OpResult(
                false,
                error = "CAMERA_PERMISSION_REQUIRED: Camera permission is required for video recording. " +
                    "Go to Settings → Apps → Jarvis app → Permissions → Camera and enable it."
            )
        }
        val audioEnabled = op.optBoolean("audio", false)
        if (audioEnabled && !hasPermission(context, Manifest.permission.RECORD_AUDIO)) {
            return OpResult(
                false,
                error = "MICROPHONE_PERMISSION_REQUIRED: Audio recording requires microphone permission. " +
                    "Disable audio or grant the microphone permission to Jarvis app in Settings."
            )
        }

        val facingStr = op.optString("facing", "back").lowercase()
        val lensFacing = if (facingStr == "front") CameraCharacteristics.LENS_FACING_FRONT
        else CameraCharacteristics.LENS_FACING_BACK
        val durationMs = op.optLong("durationMs", 5000L).coerceIn(1000L, 30_000L)

        return try {
            val mp4File = recordVideoClip(context, lensFacing, durationMs, audioEnabled)
                ?: return OpResult(
                    false,
                    error = "FOREGROUND_REQUIRED: Video recording failed — bring the Jarvis app to the foreground and try again."
                )
            val bytes = mp4File.readBytes()
            mp4File.delete()
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            DaemonLog.add("camera_clip: recorded ${bytes.size} bytes MP4 facing=$facingStr dur=${durationMs}ms")
            OpResult(
                true,
                data = JSONObject()
                    .put("video", b64)
                    .put("format", "mp4")
                    .put("facing", facingStr)
                    .put("durationMs", durationMs)
                    .put("bytes", bytes.size)
            )
        } catch (e: Exception) {
            Log.e(TAG, "handleClip failed", e)
            OpResult(false, error = "Camera clip failed: ${e.message}")
        }
    }

    // ── Camera2 still capture ──────────────────────────────────────────────

    private fun captureJpeg(context: Context, lensFacing: Int): ByteArray? {
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = findCamera(manager, lensFacing) ?: return null

        val thread = HandlerThread("cam_snap").also { it.start() }
        val handler = Handler(thread.looper)
        var result: ByteArray? = null
        val latch = CountDownLatch(1)

        val imageReader = ImageReader.newInstance(1280, 720, ImageFormat.JPEG, 2)
        imageReader.setOnImageAvailableListener({ reader ->
            val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
            try {
                val buffer = image.planes[0].buffer
                val bytes = ByteArray(buffer.remaining())
                buffer.get(bytes)
                result = bytes
            } finally {
                image.close()
                latch.countDown()
            }
        }, handler)

        var cameraDevice: CameraDevice? = null
        val openLatch = CountDownLatch(1)
        try {
            manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    cameraDevice = camera
                    openLatch.countDown()
                }
                override fun onDisconnected(camera: CameraDevice) {
                    camera.close()
                    openLatch.countDown()
                }
                override fun onError(camera: CameraDevice, error: Int) {
                    camera.close()
                    openLatch.countDown()
                }
            }, handler)
        } catch (e: SecurityException) {
            thread.quitSafely()
            return null
        } catch (e: CameraAccessException) {
            thread.quitSafely()
            return null
        }

        if (!openLatch.await(5, TimeUnit.SECONDS) || cameraDevice == null) {
            thread.quitSafely()
            return null
        }

        val surfaces = listOf(imageReader.surface)
        val captureLatch = CountDownLatch(1)
        try {
            @Suppress("DEPRECATION")
            cameraDevice!!.createCaptureSession(surfaces, object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(session: CameraCaptureSession) {
                    try {
                        val request = cameraDevice!!.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
                            addTarget(imageReader.surface)
                            set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                            set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                        }.build()
                        session.capture(request, object : CameraCaptureSession.CaptureCallback() {
                            override fun onCaptureCompleted(s: CameraCaptureSession, r: CaptureRequest, tr: TotalCaptureResult) {
                                captureLatch.countDown()
                            }
                        }, handler)
                    } catch (e: Exception) {
                        captureLatch.countDown()
                    }
                }
                override fun onConfigureFailed(session: CameraCaptureSession) {
                    captureLatch.countDown()
                }
            }, handler)
        } catch (e: Exception) {
            cameraDevice?.close()
            thread.quitSafely()
            return null
        }

        captureLatch.await(5, TimeUnit.SECONDS)
        latch.await(5, TimeUnit.SECONDS)
        cameraDevice?.close()
        imageReader.close()
        thread.quitSafely()
        return result
    }

    // ── Camera2 video recording ────────────────────────────────────────────

    private fun recordVideoClip(context: Context, lensFacing: Int, durationMs: Long, audio: Boolean): File? {
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = findCamera(manager, lensFacing) ?: return null

        val outFile = File(context.cacheDir, "jarvis_clip_${System.currentTimeMillis()}.mp4")
        val recorder = MediaRecorder()

        if (audio) recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
        recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE)
        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        if (audio) recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
        recorder.setVideoSize(1280, 720)
        recorder.setVideoFrameRate(30)
        recorder.setVideoEncodingBitRate(2_000_000)
        recorder.setOutputFile(outFile.absolutePath)
        recorder.setMaxDuration(durationMs.toInt())
        recorder.prepare()

        val recorderSurface = recorder.surface

        val thread = HandlerThread("cam_clip").also { it.start() }
        val handler = Handler(thread.looper)

        var cameraDevice: CameraDevice? = null
        val openLatch = CountDownLatch(1)
        try {
            manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) { cameraDevice = camera; openLatch.countDown() }
                override fun onDisconnected(camera: CameraDevice) { camera.close(); openLatch.countDown() }
                override fun onError(camera: CameraDevice, error: Int) { camera.close(); openLatch.countDown() }
            }, handler)
        } catch (e: Exception) {
            recorder.release()
            thread.quitSafely()
            return null
        }

        if (!openLatch.await(5, TimeUnit.SECONDS) || cameraDevice == null) {
            recorder.release()
            thread.quitSafely()
            return null
        }

        val doneLatch = CountDownLatch(1)
        recorder.setOnInfoListener { _, what, _ ->
            if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) {
                doneLatch.countDown()
            }
        }

        try {
            @Suppress("DEPRECATION")
            cameraDevice!!.createCaptureSession(listOf(recorderSurface), object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(session: CameraCaptureSession) {
                    try {
                        val request = cameraDevice!!.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                            addTarget(recorderSurface)
                            set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                        }.build()
                        session.setRepeatingRequest(request, null, handler)
                        recorder.start()
                    } catch (e: Exception) {
                        doneLatch.countDown()
                    }
                }
                override fun onConfigureFailed(session: CameraCaptureSession) { doneLatch.countDown() }
            }, handler)
        } catch (e: Exception) {
            cameraDevice?.close()
            recorder.release()
            thread.quitSafely()
            return null
        }

        val waited = doneLatch.await(durationMs + 10_000L, TimeUnit.MILLISECONDS)
        if (!waited) {
            // Force stop if max_duration callback didn't fire
            try { recorder.stop() } catch (_: Exception) {}
        }
        try { recorder.release() } catch (_: Exception) {}
        cameraDevice?.close()
        thread.quitSafely()

        return if (outFile.exists() && outFile.length() > 0) outFile else null
    }

    // ── Utilities ──────────────────────────────────────────────────────────

    private fun findCamera(manager: CameraManager, lensFacing: Int): String? {
        return try {
            manager.cameraIdList.firstOrNull { id ->
                val chars = manager.getCameraCharacteristics(id)
                chars.get(CameraCharacteristics.LENS_FACING) == lensFacing
            }
        } catch (e: Exception) { null }
    }

    private fun hasPermission(context: Context, permission: String): Boolean =
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
}
