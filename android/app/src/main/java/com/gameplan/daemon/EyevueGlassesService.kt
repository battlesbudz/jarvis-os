package com.gameplan.daemon

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.speech.tts.TextToSpeech
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

private data class PendingEyevuePhotoRequest(
    val latch: CountDownLatch?,
)

data class EyevueSnapshot(
    val enabled: Boolean,
    val connected: Boolean,
    val address: String?,
    val deviceName: String?,
    val batteryPercent: Int?,
    val capacityRaw: String?,
    val lastPhotoPath: String?,
    val lastError: String?,
) {
    fun json() = JSONObject()
        .put("available", true)
        .put("enabled", enabled)
        .put("connected", connected)
        .put("address", address ?: JSONObject.NULL)
        .put("deviceName", deviceName ?: JSONObject.NULL)
        .put("batteryPercent", batteryPercent ?: JSONObject.NULL)
        .put("capacityRaw", capacityRaw ?: JSONObject.NULL)
        .put("lastPhotoPath", lastPhotoPath ?: JSONObject.NULL)
        .put("lastError", lastError ?: JSONObject.NULL)
        .put("wakePhrase", "Hey, Star")
        .put("nativeStoragePreserved", true)
}

/**
 * Primary eyeVue companion connection. The vendor AI wake event is redirected to
 * Jarvis Talk Mode while physical media behavior remains unchanged on the glasses.
 */
class EyevueGlassesService : Service() {
    companion object {
        const val ACTION_ENABLE = "com.gameplan.daemon.EYEVUE_ENABLE"
        const val ACTION_DISCONNECT = "com.gameplan.daemon.EYEVUE_DISCONNECT"
        const val ACTION_RECONNECT = "com.gameplan.daemon.EYEVUE_RECONNECT"
        const val EXTRA_ADDRESS = "address"
        private const val PREFS = "jarvis_eyevue"
        private const val PREF_ENABLED = "enabled"
        private const val PREF_ADDRESS = "address"
        private const val CHANNEL = "jarvis_eyevue_connection"
        private const val NOTIFICATION_ID = 3014
        private const val RECONNECT_MS = 5_000L
        private const val PHOTO_REQUEST_ORIGIN_RETENTION_MS = 35_000L
        private const val TEMPORARY_PHOTO_TTL_MS = 5 * 60_000L
        private const val PHOTO_DELETE_RETRY_MS = 30_000L
        private const val PHOTO_DELETE_MAX_ATTEMPTS = 3

        @Volatile private var instance: EyevueGlassesService? = null
        @Volatile private var snapshot = EyevueSnapshot(false, false, null, null, null, null, null, null)

        fun status(context: Context): EyevueSnapshot {
            val prefs = context.getSharedPreferences(PREFS, MODE_PRIVATE)
            return snapshot.copy(
                enabled = prefs.getBoolean(PREF_ENABLED, false),
                address = snapshot.address ?: prefs.getString(PREF_ADDRESS, null),
            )
        }

        fun isEnabled(context: Context) = context.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(PREF_ENABLED, false)

        fun command(context: Context, name: String, waitForPhoto: Boolean = false): OpResult {
            val service = instance ?: return OpResult(false, error = "EYEVUE_NOT_CONNECTED: Enable eyeVue in Jarvis and keep the glasses nearby.")
            return service.runCommand(name, waitForPhoto)
        }

        fun discardTemporaryPhoto(expectedPath: String? = null): Boolean? {
            val currentPath = snapshot.lastPhotoPath ?: return null
            if (expectedPath != null && expectedPath != currentPath) return null
            val deleted = runCatching {
                val file = File(currentPath)
                !file.exists() || file.delete()
            }.getOrDefault(false)
            if (!deleted) {
                DaemonLog.add("eyevue: temporary photo deletion failed; retaining cleanup path")
                return false
            }
            if (snapshot.lastPhotoPath == currentPath) {
                snapshot = snapshot.copy(lastPhotoPath = null)
            }
            return true
        }

        fun hasBluetoothPermission(context: Context) = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
                ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
                    ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ->
                ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            else -> true
        }

        fun start(context: Context, address: String? = null): Boolean {
            if (!hasBluetoothPermission(context)) {
                snapshot = snapshot.copy(connected = false, lastError = "Nearby devices permission is required before enabling eyeVue.")
                DaemonLog.add("eyevue: foreground service start blocked until Nearby Devices is granted")
                return false
            }
            val intent = Intent(context, EyevueGlassesService::class.java).apply {
                action = ACTION_ENABLE
                address?.let { putExtra(EXTRA_ADDRESS, it) }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
            return true
        }
    }

    private val worker = Executors.newSingleThreadExecutor()
    private val connecting = AtomicBoolean(false)
    private val decoder = EyevueFrameDecoder()
    private val photoAssembler = EyevuePhotoAssembler()
    private val pendingPhoto = AtomicReference<PendingEyevuePhotoRequest?>(null)
    private var gatt: BluetoothGatt? = null
    private var write: BluetoothGattCharacteristic? = null
    private var notify: BluetoothGattCharacteristic? = null
    private var photoNotify: BluetoothGattCharacteristic? = null
    private var scanCallback: ScanCallback? = null
    private var warnedAt20 = false
    private var warnedAt10 = false

    override fun onCreate() {
        super.onCreate()
        instance = this
        createChannel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_RECONNECT
        when (action) {
            ACTION_DISCONNECT -> {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(PREF_ENABLED, false).apply()
                closeConnection()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_ENABLE -> {
                val address = intent?.getStringExtra(EXTRA_ADDRESS)?.trim().orEmpty()
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putBoolean(PREF_ENABLED, true)
                    .apply { if (address.isNotBlank()) putString(PREF_ADDRESS, address) }
                    .apply()
            }
        }
        if (!hasBluetoothPermission(this)) {
            snapshot = snapshot.copy(connected = false, lastError = "Nearby devices permission is required before enabling eyeVue.")
            DaemonLog.add("eyevue: stopped before connected-device foreground start because Nearby Devices is missing")
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(NOTIFICATION_ID, notification("Looking for eyeVue glasses…"))
        scheduleConnect(0)
        return START_STICKY
    }

    override fun onDestroy() {
        instance = null
        closeConnection()
        worker.shutdownNow()
        discardTemporaryPhoto()
        super.onDestroy()
    }

    private fun scheduleConnect(delayMs: Long) {
        if (!isEnabled(this)) return
        android.os.Handler(mainLooper).postDelayed({ connectSavedOrDiscover() }, delayMs)
    }

    @SuppressLint("MissingPermission")
    private fun connectSavedOrDiscover() {
        if (!hasBluetoothPermission() || gatt != null || !connecting.compareAndSet(false, true)) {
            if (!hasBluetoothPermission()) updateError("Nearby devices permission is required.")
            return
        }
        val manager = getSystemService(BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = manager?.adapter
        if (adapter == null || !adapter.isEnabled) {
            connecting.set(false)
            updateError("Bluetooth is off.")
            scheduleConnect(RECONNECT_MS)
            return
        }
        val saved = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_ADDRESS, null)
        if (!saved.isNullOrBlank()) {
            runCatching { adapter.getRemoteDevice(saved) }.getOrNull()?.let { connect(it); return }
        }
        adapter.bondedDevices.firstOrNull { isEyevue(it.name) }?.let { connect(it); return }
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val device = result.device
                if (isEyevue(result.scanRecord?.deviceName) || isEyevue(runCatching { device.name }.getOrNull())) {
                    adapter.bluetoothLeScanner?.stopScan(this)
                    scanCallback = null
                    connect(device)
                }
            }
            override fun onScanFailed(errorCode: Int) {
                scanCallback = null
                connecting.set(false)
                updateError("eyeVue Bluetooth scan failed ($errorCode).")
                scheduleConnect(RECONNECT_MS)
            }
        }
        scanCallback = callback
        adapter.bluetoothLeScanner?.startScan(callback) ?: run {
            connecting.set(false)
            updateError("Bluetooth LE scanning is unavailable.")
        }
        android.os.Handler(mainLooper).postDelayed({
            if (scanCallback === callback) {
                adapter.bluetoothLeScanner?.stopScan(callback)
                scanCallback = null
                connecting.set(false)
                scheduleConnect(RECONNECT_MS)
            }
        }, 10_000)
    }

    @SuppressLint("MissingPermission")
    private fun connect(device: BluetoothDevice) {
        snapshot = snapshot.copy(address = device.address, deviceName = runCatching { device.name }.getOrNull(), lastError = null)
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_ADDRESS, device.address).apply()
        gatt = device.connectGatt(this, false, callback, BluetoothDevice.TRANSPORT_LE)
    }

    private val callback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(callbackGatt: BluetoothGatt, status: Int, newState: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
                callbackGatt.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                closeConnection()
                snapshot = snapshot.copy(connected = false, lastError = if (status == 0) null else "Bluetooth disconnected ($status).")
                updateNotification("eyeVue disconnected; reconnecting…")
                scheduleConnect(RECONNECT_MS)
            }
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(callbackGatt: BluetoothGatt, status: Int) {
            val service = callbackGatt.getService(EyevueProtocol.SERVICE_UUID)
            write = service?.getCharacteristic(EyevueProtocol.COMMAND_WRITE_UUID)
            notify = service?.getCharacteristic(EyevueProtocol.COMMAND_NOTIFY_UUID)
            photoNotify = service?.getCharacteristic(EyevueProtocol.PHOTO_NOTIFY_UUID)
            if (status != BluetoothGatt.GATT_SUCCESS || write == null || notify == null || photoNotify == null) {
                failGattSetup(callbackGatt, "This Bluetooth device does not expose the eyeVue AA12 service; reconnecting.")
                return
            }
            if (!enableNotification(callbackGatt, notify!!)) {
                failGattSetup(callbackGatt, "eyeVue command notifications could not be enabled.")
            }
        }

        @SuppressLint("MissingPermission")
        override fun onDescriptorWrite(callbackGatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                failGattSetup(callbackGatt, "eyeVue notification setup failed ($status); reconnecting.")
                return
            }
            if (descriptor.characteristic.uuid == EyevueProtocol.COMMAND_NOTIFY_UUID) {
                if (!enableNotification(callbackGatt, photoNotify!!)) {
                    failGattSetup(callbackGatt, "eyeVue photo notifications could not be enabled.")
                }
            } else if (descriptor.characteristic.uuid == EyevueProtocol.PHOTO_NOTIFY_UUID) {
                connecting.set(false)
                snapshot = snapshot.copy(connected = true, lastError = null)
                updateNotification("eyeVue connected — Hey, Star starts Jarvis")
                writePacket(EyevueProtocol.battery())
                writePacket(EyevueProtocol.capacity())
            }
        }

        @Deprecated("Deprecated in Java")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            handleNotification(characteristic, characteristic.value.copyOf())
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            handleNotification(characteristic, value.copyOf())
        }
    }

    private fun handleNotification(characteristic: BluetoothGattCharacteristic, value: ByteArray) {
        if (characteristic.uuid == EyevueProtocol.COMMAND_NOTIFY_UUID) {
            decoder.append(value).forEach(::handleFrame)
        } else if (characteristic.uuid == EyevueProtocol.PHOTO_NOTIFY_UUID) {
            photoAssembler.append(value)?.let(::saveCapturedPhoto)
        }
    }

    private fun handleFrame(frame: EyevueFrame) {
        when (frame.commandId) {
            EyevueProtocol.CMD_WAKE_START -> {
                DaemonLog.add("eyevue: Hey Star wake event")
                // Stop the glasses' vendor recognition stream while retaining the
                // firmware wake detector and native action sounds.
                writePacket(EyevueProtocol.stopVendorVoice())
                if (WebSocketService.instance?.isConnected != true) {
                    speakOffline()
                    return
                }
                val intent = Intent(this, WakeWordService::class.java).apply {
                    action = WakeWordService.ACTION_EXTERNAL_WAKE
                    putExtra(WakeWordService.EXTRA_EXTERNAL_PHRASE, "hey star")
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
            }
            EyevueProtocol.CMD_BATTERY, 83 -> {
                val percent = if (frame.commandId == 83) frame.payload.getOrNull(1)?.toInt()?.and(0xff)
                    else frame.payload.takeIf { it.size >= 2 }?.let { ((it[0].toInt() and 0x0f) * 10) + (it[1].toInt() and 0x0f) }
                snapshot = snapshot.copy(batteryPercent = percent)
                if (percent != null) {
                    if (percent > 20) { warnedAt20 = false; warnedAt10 = false }
                    val threshold = when {
                        percent <= 10 && !warnedAt10 -> 10.also { warnedAt10 = true; warnedAt20 = true }
                        percent <= 20 && !warnedAt20 -> 20.also { warnedAt20 = true }
                        else -> null
                    }
                    threshold?.let {
                        WebSocketService.sendEvent(
                            JSONObject().put("type", "eyevue_battery_low").put("percent", percent).put("threshold", it).toString(),
                        )
                    }
                }
            }
            EyevueProtocol.CMD_CAPACITY -> snapshot = snapshot.copy(capacityRaw = frame.payload.joinToString("") { "%02x".format(it) })
        }
        DaemonLog.add("eyevue: rx command=${frame.commandId} bytes=${frame.payload.size}")
    }

    private fun saveCapturedPhoto(bytes: ByteArray) {
        val directory = File(cacheDir, "eyevue").apply { mkdirs() }
        val file = File(directory, "capture-${System.currentTimeMillis()}.jpg")
        file.writeBytes(bytes)
        val requestedCapture = pendingPhoto.getAndSet(null)
        snapshot.lastPhotoPath?.let { old -> deleteFileWithRetry(old, "replacement") }
        snapshot = snapshot.copy(lastPhotoPath = file.absolutePath)
        requestedCapture?.latch?.countDown()
        val origin = if (requestedCapture == null) "camera_button" else "jarvis_request"
        DaemonLog.add("eyevue: photo received bytes=${bytes.size} origin=$origin; temporary copy retained for active visual turn")
        if (requestedCapture == null) {
            WebSocketService.sendEvent(
                JSONObject()
                    .put("type", "eyevue_photo_captured")
                    .put("imagePath", file.absolutePath)
                    .put("source", "glasses")
                    .put("origin", origin)
                    .toString(),
            )
        }
        // All phone-side copies are bounded. Camera-button turns normally delete
        // sooner through the server's exact-path cleanup; requested photos retain
        // a short window for visual follow-ups or the user's save destination.
        scheduleTemporaryPhotoExpiry(file.absolutePath, origin)
    }

    private fun scheduleTemporaryPhotoExpiry(path: String, origin: String, attempt: Int = 0) {
        val delayMs = if (attempt == 0) TEMPORARY_PHOTO_TTL_MS else PHOTO_DELETE_RETRY_MS
        android.os.Handler(mainLooper).postDelayed({
            when (discardTemporaryPhoto(path)) {
                true -> DaemonLog.add("eyevue: expired $origin temporary photo after bounded retention")
                false -> {
                    if (attempt < PHOTO_DELETE_MAX_ATTEMPTS) {
                        scheduleTemporaryPhotoExpiry(path, origin, attempt + 1)
                    } else {
                        DaemonLog.add("eyevue: temporary photo cleanup still failing after ${attempt + 1} attempts")
                    }
                }
                null -> Unit
            }
        }, delayMs)
    }

    private fun deleteFileWithRetry(path: String, reason: String, attempt: Int = 0) {
        val deleted = runCatching {
            val file = File(path)
            !file.exists() || file.delete()
        }.getOrDefault(false)
        if (deleted) return
        if (attempt < PHOTO_DELETE_MAX_ATTEMPTS) {
            android.os.Handler(mainLooper).postDelayed({
                deleteFileWithRetry(path, reason, attempt + 1)
            }, PHOTO_DELETE_RETRY_MS)
        } else {
            DaemonLog.add("eyevue: orphan cleanup failed reason=$reason after ${attempt + 1} attempts")
        }
    }

    private fun runCommand(name: String, waitForPhoto: Boolean): OpResult {
        if (snapshot.connected != true) return OpResult(false, error = "EYEVUE_NOT_CONNECTED: The glasses connection is unavailable.")
        val packet = when (name) {
            "battery" -> EyevueProtocol.battery()
            "storage" -> EyevueProtocol.capacity()
            "photo" -> EyevueProtocol.photo()
            "video_start" -> EyevueProtocol.video(true)
            "video_stop" -> EyevueProtocol.video(false)
            "audio_start" -> EyevueProtocol.audio(true)
            "audio_stop" -> EyevueProtocol.audio(false)
            else -> return OpResult(false, error = "EYEVUE_COMMAND_UNKNOWN: $name")
        }
        val latch = if (name == "photo" && waitForPhoto) CountDownLatch(1) else null
        val photoRequest = if (name == "photo") PendingEyevuePhotoRequest(latch) else null
        if (photoRequest != null && !pendingPhoto.compareAndSet(null, photoRequest)) {
            return OpResult(false, error = "EYEVUE_PHOTO_BUSY: A requested photo is already awaiting its AA15 response.")
        }
        if (photoRequest != null) {
            android.os.Handler(mainLooper).postDelayed({
                pendingPhoto.compareAndSet(photoRequest, null)
            }, PHOTO_REQUEST_ORIGIN_RETENTION_MS)
        }
        if (!writePacket(packet)) {
            photoRequest?.let { pendingPhoto.compareAndSet(it, null) }
            return OpResult(false, error = "EYEVUE_WRITE_FAILED: The command could not be sent.")
        }
        if (latch != null && !latch.await(30, TimeUnit.SECONDS)) {
            return OpResult(false, error = "EYEVUE_PHOTO_TIMEOUT: No image arrived within 30 seconds. Ask whether to save/retry or use cloud vision.")
        }
        return OpResult(true, status(this).json().put("command", name).put("savePromptRequired", name in setOf("photo", "video_stop", "audio_stop")))
    }

    @SuppressLint("MissingPermission")
    private fun writePacket(packet: ByteArray): Boolean {
        val currentGatt = gatt ?: return false
        val characteristic = write ?: return false
        characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        return if (Build.VERSION.SDK_INT >= 33) {
            currentGatt.writeCharacteristic(characteristic, packet, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothGatt.GATT_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            run { characteristic.value = packet; currentGatt.writeCharacteristic(characteristic) }
        }
    }

    @SuppressLint("MissingPermission")
    private fun enableNotification(currentGatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic): Boolean {
        if (!currentGatt.setCharacteristicNotification(characteristic, true)) return false
        val descriptor = characteristic.getDescriptor(EyevueProtocol.CCCD_UUID) ?: return false
        return if (Build.VERSION.SDK_INT >= 33) {
            currentGatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothGatt.GATT_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            run { descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE; currentGatt.writeDescriptor(descriptor) }
        }
    }

    @SuppressLint("MissingPermission")
    private fun failGattSetup(callbackGatt: BluetoothGatt, message: String) {
        if (gatt === callbackGatt) {
            closeConnection()
        } else {
            runCatching { callbackGatt.disconnect(); callbackGatt.close() }
        }
        updateError(message)
        scheduleConnect(RECONNECT_MS)
    }

    @SuppressLint("MissingPermission")
    private fun closeConnection() {
        val manager = getSystemService(BLUETOOTH_SERVICE) as? BluetoothManager
        scanCallback?.let { runCatching { manager?.adapter?.bluetoothLeScanner?.stopScan(it) } }
        scanCallback = null
        runCatching { gatt?.disconnect(); gatt?.close() }
        gatt = null
        write = null
        notify = null
        photoNotify = null
        connecting.set(false)
        snapshot = snapshot.copy(connected = false)
    }

    private fun isEyevue(name: String?) = name?.lowercase()?.let {
        "eyevue" in it || "eye vue" in it || "cyo3" in it || it.startsWith("sk-")
    } == true

    private fun hasBluetoothPermission() = Companion.hasBluetoothPermission(this)

    private fun updateError(message: String) {
        connecting.set(false)
        snapshot = snapshot.copy(connected = false, lastError = message)
        updateNotification(message)
        DaemonLog.add("eyevue: $message")
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "eyeVue glasses", NotificationManager.IMPORTANCE_LOW))
        }
    }

    private fun notification(message: String): android.app.Notification {
        val disconnect = PendingIntent.getService(this, 0, Intent(this, EyevueGlassesService::class.java).setAction(ACTION_DISCONNECT), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Jarvis eyeVue companion")
            .setContentText(message)
            .setOngoing(true)
            .addAction(0, "Disconnect", disconnect)
            .build()
    }

    private fun updateNotification(message: String) {
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, notification(message))
    }

    private fun speakOffline() {
        // Deliberately do not start the vendor assistant when Jarvis is offline.
        WearableAudioRouteManager.acquire(this, "eyevue_offline") { route ->
            if (route.state == "failed") {
                DaemonLog.add("eyevue: offline cue using phone speaker (${route.message})")
            }
        }
        var tts: TextToSpeech? = null
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.speak("Jarvis is offline.", TextToSpeech.QUEUE_FLUSH, null, "eyevue-offline")
                android.os.Handler(mainLooper).postDelayed({
                    tts?.shutdown()
                    WearableAudioRouteManager.release("eyevue_offline")
                }, 2_500)
            } else {
                tts?.shutdown()
                WearableAudioRouteManager.release("eyevue_offline")
            }
        }
    }
}

object EyevueCommandHandler {
    fun handle(context: Context, op: JSONObject): OpResult = when (op.optString("type")) {
        "android_eyevue_status" -> OpResult(true, EyevueGlassesService.status(context).json())
        "android_eyevue_enable" -> {
            if (!EyevueGlassesService.start(context, op.optString("address").takeIf { it.isNotBlank() })) {
                OpResult(false, error = "EYEVUE_PERMISSION_REQUIRED: Grant Nearby Devices before enabling the eyeVue companion.")
            } else {
                OpResult(true, EyevueGlassesService.status(context).json().put("status", "connecting"))
            }
        }
        "android_eyevue_disconnect" -> {
            context.startService(Intent(context, EyevueGlassesService::class.java).setAction(EyevueGlassesService.ACTION_DISCONNECT))
            OpResult(true, JSONObject().put("connected", false).put("enabled", false))
        }
        "android_eyevue_command" -> EyevueGlassesService.command(context, op.optString("command"), op.optBoolean("waitForPhoto", false))
        "android_eyevue_look" -> look(context, op)
        "android_eyevue_discard_photo" -> {
            val expectedPath = op.optString("imagePath").takeIf { it.isNotBlank() }
            if (expectedPath == null) {
                OpResult(false, error = "EYEVUE_IMAGE_PATH_REQUIRED: Refusing to discard an unspecified temporary photo.")
            } else {
                when (val discarded = EyevueGlassesService.discardTemporaryPhoto(expectedPath)) {
                    false -> OpResult(false, error = "EYEVUE_IMAGE_DELETE_FAILED: The temporary photo remains queued for device-local cleanup.")
                    else -> OpResult(true, JSONObject().put("discarded", discarded == true))
                }
            }
        }
        else -> OpResult(false, error = "Unsupported eyeVue operation.")
    }

    private fun look(context: Context, op: JSONObject): OpResult {
        val takeNew = op.optBoolean("lookAgain", false) || EyevueGlassesService.status(context).lastPhotoPath.isNullOrBlank()
        if (takeNew) {
            val capture = EyevueGlassesService.command(context, "photo", waitForPhoto = true)
            if (!capture.ok) return capture
        }
        val imagePath = EyevueGlassesService.status(context).lastPhotoPath
            ?: return OpResult(false, error = "EYEVUE_IMAGE_UNAVAILABLE: Ask whether the user wants the image saved or wants to retry.")
        val prompt = op.optString("question", "").ifBlank {
            "Describe this scene at moderate detail. Lead with the main scene and important details. " +
                "Call out immediate hazards or obstacles, important readable text, and people I may be interacting with. " +
                "Describe people without identifying them. Do not guess identities. End by asking whether I want to know anything else."
        }
        val result = LocalGemmaModelManager.generate(
            context,
            JSONObject()
                .put("model", "gemma-4-e4b-it")
                .put("prompt", prompt)
                .put("imagePath", imagePath)
                .put("keepEngineWarm", true)
                .put("maxTokens", 256),
        )
        if (!result.ok) {
            return OpResult(false, error = "EYEVUE_LOCAL_VISION_FAILED: ${result.error} Ask whether to save the image, then ask before any cloud fallback.")
        }
        return OpResult(true, (result.data as? JSONObject ?: JSONObject()).put("imagePath", imagePath).put("temporaryImage", true).put("cloudUsed", false))
    }
}
