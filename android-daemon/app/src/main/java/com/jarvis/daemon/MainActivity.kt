package com.jarvis.daemon

import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.SharedPreferences
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.jarvis.daemon.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: SharedPreferences
    private var wsService: WebSocketService? = null
    private var serviceBound = false
    private val logHandler = Handler(Looper.getMainLooper())

    private val requestNotificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (!granted) {
            Toast.makeText(this, "Notification permission required for app-launch actions. Please grant it in Settings → Apps → Jarvis Daemon → Notifications.", Toast.LENGTH_LONG).show()
        }
    }

    private val requestMicrophonePermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        checkPermissionsStatus()
        if (!granted) {
            Toast.makeText(this, "Microphone permission is required for wake word detection ('Hey Jarvis'). Grant it in Settings → Apps → Jarvis Daemon → Permissions.", Toast.LENGTH_LONG).show()
        }
    }

    private val requestCameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        checkPermissionsStatus()
        if (!granted) {
            Toast.makeText(this, "Camera permission is required for photo/video capture. Grant it in Settings → Apps → Jarvis Daemon → Permissions.", Toast.LENGTH_LONG).show()
        }
    }

    private val requestScreenCapture = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            ScreenRecordHandler.projectionIntent = result.data
            checkPermissionsStatus()
            Toast.makeText(this, "Screen recording granted ✓", Toast.LENGTH_SHORT).show()
        } else {
            checkPermissionsStatus()
            Toast.makeText(this, "Screen recording permission denied", Toast.LENGTH_SHORT).show()
        }
    }

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val b = binder as? WebSocketService.LocalBinder ?: return
            wsService = b.getService()
            serviceBound = true
            wsService?.onStatusChanged = { status, connected ->
                runOnUiThread { updateStatus(status, connected) }
            }
            updateStatus(wsService?.currentStatus ?: "Disconnected", wsService?.isConnected ?: false)
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            wsService = null
            serviceBound = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = getSharedPreferences("jarvis_daemon", Context.MODE_PRIVATE)

        val savedUrl = prefs.getString("server_url", "") ?: ""
        if (savedUrl.isNotEmpty()) {
            binding.etServerUrl.setText(savedUrl)
        }

        binding.etServerUrl.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                prefs.edit().putString("server_url", s.toString().trim()).apply()
            }
        })

        binding.btnPair.setOnClickListener {
            val url = binding.etServerUrl.text.toString().trim()
            val code = binding.etPairCode.text.toString().trim().uppercase()
            if (url.isEmpty()) {
                Toast.makeText(this, "Enter the Jarvis server URL first", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (code.length != 8) {
                Toast.makeText(this, "Pairing code must be 8 characters", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            startDaemonService(url, code)
            binding.etPairCode.setText("")
        }

        binding.btnDisconnect.setOnClickListener {
            stopDaemonService()
        }

        binding.btnCheckAccessibility.setOnClickListener {
            openAccessibilitySettings()
        }

        binding.btnCheckNotification.setOnClickListener {
            openNotificationListenerSettings()
        }

        binding.btnCheckStorage.setOnClickListener {
            openStoragePermission()
        }

        binding.btnGrantMicrophone.setOnClickListener {
            requestMicrophonePermissionIfNeeded()
        }

        binding.btnGrantCamera.setOnClickListener {
            requestCameraPermission.launch(android.Manifest.permission.CAMERA)
        }

        binding.btnGrantScreenRecord.setOnClickListener {
            val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            requestScreenCapture.launch(mpm.createScreenCaptureIntent())
        }

        requestNotificationPermissionIfNeeded()
        requestMicrophonePermissionIfNeeded()
        checkPermissionsStatus()
        bindToService()
        UpdateChecker.check(this)

        DaemonLog.onChanged = {
            logHandler.post { refreshLogPanel() }
        }
        refreshLogPanel()
    }

    private fun refreshLogPanel() {
        val lines = DaemonLog.getAll()
        val count = lines.size
        // Show newest entries at top so the user sees the most recent activity without scrolling
        binding.tvActivityLog.text = if (lines.isEmpty()) {
            "No activity yet"
        } else {
            lines.reversed().joinToString("\n")
        }
        binding.tvLogCount.text = if (count > 0) "$count entries" else ""
    }

    override fun onResume() {
        super.onResume()
        checkPermissionsStatus()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
                android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestNotificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun requestMicrophonePermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            requestMicrophonePermission.launch(android.Manifest.permission.RECORD_AUDIO)
        }
    }

    private fun isMicrophoneGranted(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
        checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED

    private fun bindToService() {
        val intent = Intent(this, WebSocketService::class.java)
        bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    private fun startDaemonService(serverUrl: String, pairCode: String) {
        val intent = Intent(this, WebSocketService::class.java).apply {
            action = WebSocketService.ACTION_CONNECT
            putExtra(WebSocketService.EXTRA_SERVER_URL, serverUrl)
            putExtra(WebSocketService.EXTRA_PAIR_CODE, pairCode)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        prefs.edit().putString("server_url", serverUrl).apply()
        Toast.makeText(this, "Connecting to Jarvis…", Toast.LENGTH_SHORT).show()
    }

    private fun stopDaemonService() {
        val intent = Intent(this, WebSocketService::class.java).apply {
            action = WebSocketService.ACTION_DISCONNECT
        }
        startService(intent)
        Toast.makeText(this, "Disconnected", Toast.LENGTH_SHORT).show()
    }

    private fun updateStatus(status: String, connected: Boolean) {
        binding.tvStatus.text = status
        binding.tvStatusDot.setBackgroundResource(
            if (connected) R.drawable.dot_green else R.drawable.dot_gray
        )
        val serviceActive = connected ||
            status.contains("Connecting") ||
            status.contains("Reconnecting")
        binding.btnDisconnect.visibility = if (serviceActive) View.VISIBLE else View.GONE
        binding.btnPair.visibility = if (serviceActive) View.GONE else View.VISIBLE
        binding.layoutPairInput.visibility = if (serviceActive) View.GONE else View.VISIBLE
    }

    private fun isCameraGranted(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
        checkSelfPermission(android.Manifest.permission.CAMERA) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED

    private fun isScreenRecordGranted(): Boolean = ScreenRecordHandler.projectionIntent != null

    private fun checkPermissionsStatus() {
        val accessibilityEnabled = isAccessibilityEnabled()
        val storageGranted = isStorageGranted()
        val notificationListenerEnabled = isNotificationListenerEnabled()
        val micGranted = isMicrophoneGranted()
        val cameraGranted = isCameraGranted()
        val screenRecordGranted = isScreenRecordGranted()

        binding.tvAccessibilityStatus.text = if (accessibilityEnabled) "✓ Enabled — phone control active" else "✗ Not enabled — tap Fix (REQUIRED for screen control)"
        binding.tvAccessibilityStatus.setTextColor(
            if (accessibilityEnabled) getColor(R.color.status_ok) else getColor(R.color.status_warn)
        )

        binding.tvNotificationStatus.text = if (notificationListenerEnabled) "✓ Granted — reading notifications" else "✗ Not granted — tap Fix (needed to read notifications)"
        binding.tvNotificationStatus.setTextColor(
            if (notificationListenerEnabled) getColor(R.color.status_ok) else getColor(R.color.status_warn)
        )

        binding.tvStorageStatus.text = if (storageGranted) "✓ Granted" else "✗ Not granted — tap to fix"
        binding.tvStorageStatus.setTextColor(
            if (storageGranted) getColor(R.color.status_ok) else getColor(R.color.status_warn)
        )

        binding.tvMicrophoneStatus.text = if (micGranted) "✓ Granted — wake word detection ready" else "✗ Not granted — tap Grant (required for 'Hey Jarvis')"
        binding.tvMicrophoneStatus.setTextColor(
            if (micGranted) getColor(R.color.status_ok) else getColor(R.color.status_warn)
        )
        binding.btnGrantMicrophone.visibility = if (micGranted) View.GONE else View.VISIBLE

        binding.tvCameraStatus.text = if (cameraGranted) "✓ Granted — camera capture enabled" else "✗ Not granted — tap Grant to enable photos/video"
        binding.tvCameraStatus.setTextColor(
            if (cameraGranted) getColor(R.color.status_ok) else getColor(R.color.status_warn)
        )
        binding.btnGrantCamera.visibility = if (cameraGranted) View.GONE else View.VISIBLE

        binding.tvScreenRecordStatus.text = if (screenRecordGranted) "✓ Granted — screen recording enabled" else "Not granted — tap Allow to enable screen recording"
        binding.tvScreenRecordStatus.setTextColor(
            if (screenRecordGranted) getColor(R.color.status_ok) else getColor(R.color.status_warn)
        )
    }

    private fun isAccessibilityEnabled(): Boolean {
        val service = "${packageName}/${JarvisAccessibilityService::class.java.canonicalName}"
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        return enabled.contains(service)
    }

    private fun isNotificationListenerEnabled(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: ""
        return flat.contains(packageName)
    }

    private fun isStorageGranted(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED
        }
    }

    private fun openAccessibilitySettings() {
        AlertDialog.Builder(this)
            .setTitle("Enable Accessibility Service")
            .setMessage("1. Tap 'Installed apps' or scroll to find 'Jarvis Daemon'\n2. Tap it and enable the toggle\n3. Confirm any warnings\n\nThis allows Jarvis to read your screen and perform actions on your behalf.")
            .setPositiveButton("Open Settings") { _, _ ->
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun openNotificationListenerSettings() {
        AlertDialog.Builder(this)
            .setTitle("Grant Notification Access")
            .setMessage("1. Find 'Jarvis Daemon' in the list\n2. Tap it and enable 'Allow notification access'\n3. Confirm any warnings\n\nThis allows Jarvis to read your phone's notifications.")
            .setPositiveButton("Open Settings") { _, _ ->
                try {
                    startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))
                } catch (e: Exception) {
                    startActivity(Intent(Settings.ACTION_SETTINGS))
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun openStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            AlertDialog.Builder(this)
                .setTitle("Allow File Access")
                .setMessage("Jarvis needs 'All files access' to read your gallery, downloads, and other folders.\n\nIn the next screen, find 'Jarvis Daemon' and enable 'Allow access to manage all files'.")
                .setPositiveButton("Open Settings") { _, _ ->
                    try {
                        val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                            Uri.parse("package:$packageName"))
                        startActivity(intent)
                    } catch (e: Exception) {
                        startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
                    }
                }
                .setNegativeButton("Cancel", null)
                .show()
        } else {
            requestPermissions(arrayOf(
                android.Manifest.permission.READ_EXTERNAL_STORAGE,
                android.Manifest.permission.WRITE_EXTERNAL_STORAGE
            ), 1001)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        DaemonLog.onChanged = null
        if (serviceBound) {
            unbindService(serviceConnection)
            serviceBound = false
        }
    }
}
