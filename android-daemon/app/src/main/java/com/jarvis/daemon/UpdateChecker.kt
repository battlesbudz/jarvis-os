package com.jarvis.daemon

import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

object UpdateChecker {

    private const val TAG = "JarvisUpdate"
    private const val MANIFEST_PATH = "/api/app-update/android-daemon"
    private const val APK_PATH = "/api/download/apk"

    private fun serverUrl(path: String): String =
        JarvisConfig.normalizeServerUrl(JarvisConfig.SERVER_URL).trimEnd('/') + path

    fun check(activity: Activity) {
        Thread {
            try {
                val conn = URL(serverUrl(MANIFEST_PATH)).openConnection() as HttpURLConnection
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.instanceFollowRedirects = true
                if (conn.responseCode != 200) {
                    Log.d(TAG, "Version check returned ${conn.responseCode}")
                    return@Thread
                }
                val body = conn.inputStream.bufferedReader().readText()
                val json = JSONObject(body)
                val remoteCode = json.getInt("versionCode")
                val remoteName = json.getString("versionName")
                val apkUrl = json.optString("apkUrl", serverUrl(APK_PATH))
                val localCode = BuildConfig.VERSION_CODE
                Log.d(TAG, "Local versionCode=$localCode, remote=$remoteCode ($remoteName)")
                if (remoteCode > localCode) {
                    activity.runOnUiThread {
                        showUpdateDialog(activity, remoteName, apkUrl)
                    }
                }
            } catch (e: Exception) {
                Log.d(TAG, "Update check failed: ${e.message}")
            }
        }.start()
    }

    private fun showUpdateDialog(activity: Activity, newVersion: String, apkUrl: String) {
        AlertDialog.Builder(activity)
            .setTitle("Update Available — v$newVersion")
            .setMessage(
                "A newer version of Jarvis Daemon is ready.\n\n" +
                "Tap Update to download and install it now. " +
                "Your pairing settings will be preserved."
            )
            .setPositiveButton("Update Now") { _, _ ->
                downloadAndInstall(activity, apkUrl)
            }
            .setNegativeButton("Later", null)
            .show()
    }

    private fun downloadAndInstall(context: Context, apkUrl: String) {
        val destFile = File(context.getExternalFilesDir(null), "jarvis-daemon-update.apk")
        if (destFile.exists()) destFile.delete()

        val request = DownloadManager.Request(Uri.parse(apkUrl.ifBlank { serverUrl(APK_PATH) }))
            .setTitle("Jarvis Daemon Update")
            .setDescription("Downloading new version…")
            .setNotificationVisibility(
                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
            )
            .setDestinationUri(Uri.fromFile(destFile))

        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val downloadId = dm.enqueue(request)

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
                if (id == downloadId) {
                    ctx.unregisterReceiver(this)
                    installApk(ctx, destFile)
                }
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(
                receiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                Context.RECEIVER_NOT_EXPORTED
            )
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(
                receiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
            )
        }
    }

    private fun installApk(context: Context, apkFile: File) {
        if (!apkFile.exists()) {
            Log.e(TAG, "APK file not found after download")
            return
        }
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            apkFile
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
        }
        context.startActivity(intent)
    }
}
