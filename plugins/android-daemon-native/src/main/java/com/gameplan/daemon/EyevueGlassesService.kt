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
    val timedOut: AtomicBoolean = AtomicBoolean(false),
    val failure: AtomicReference<String?> = AtomicReference(null),
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
 * Primary connection to the exact device selected in the Jarvis setup flow.
 * Physical media behavior remains unchanged on the glasses. "Hey, Star" reaches
 * Jarvis through Android's selected assistant route instead of a guessed BLE packet.
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
        private const val PHOTO_LATE_RESPONSE_QUARANTINE_MS = 60_000L
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
            val currentPath = snapshot.lastPhotoPath
            val targetPath = expectedPath ?: currentPath ?: return null
            val allowedDirectory = runCatching {
                instance?.let { File(it.cacheDir, "eyevue").canonicalFile }
                    ?: currentPath?.let { File(it).canonicalFile.parentFile }
            }.getOrNull() ?: return false
            val targetFile = runCatching { File(targetPath).canonicalFile }.getOrNull() ?: return false
            if (targetFile.parentFile != allowedDirectory || !targetFile.name.startsWith("capture-") || targetFile.extension != "jpg") {
                DaemonLog.add("eyevue: refused temporary photo deletion outside the device-local capture cache")
                return false
            }
            val deleted = runCatching {
                !targetFile.exists() || targetFile.delete()
            }.getOrDefault(false)
            if (!deleted) {
                DaemonLog.add("eyevue: temporary photo deletion failed; retaining cleanup path")
                return false
            }
            if (snapshot.lastPhotoPath == targetFile.absolutePath) {
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

        fun purgeTemporaryPhotos(context: Context, reason: String) {
            val directory = File(context.cacheDir, "eyevue")
            directory.listFiles()?.filter { it.isFile }?.forEach { cachedPhoto ->
                deleteCachedFileWithRetry(context, cachedPhoto.absolutePath, reason)
            }
            snapshot = snapshot.copy(lastPhotoPath = null)
            DaemonLog.add("eyevue: temporary-photo cache sweep requested reason=$reason")
        }

        private fun deleteCachedFileWithRetry(context: Context, path: String, reason: String, attempt: Int = 0) {
            val deleted = runCatching {
                val file = File(path)
                !file.exists() || file.delete()
            }.getOrDefault(false)
            if (deleted) return
            if (attempt < PHOTO_DELETE_MAX_ATTEMPTS) {
                android.os.Handler(context.mainLooper).postDelayed({
                    deleteCachedFileWithRetry(context, path, reason, attempt + 1)
                }, PHOTO_DELETE_RETRY_MS)
            } else {
                DaemonLog.add("eyevue: cache sweep failed reason=$reason after ${attempt + 1} attempts")
            }
        }

        fun start(context: Context, address: String? = null): Boolean {
            // Cleanup must not depend on BLE permission: a process restart plus
            // revoked permission must still remove prior temporary captures.
            if (instance == null) purgeTemporaryPhotos(context, "pre_service_start")
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
    private val gattStateLock = Any()
    @Volatile private var gatt: BluetoothGatt? = null
    private var write: BluetoothGattCharacteristic? = null
    private var notify: BluetoothGattCharacteristic? = null
    private var photoNotify: BluetoothGattCharacteristic? = null
    private var warnedAt20 = false
    private var warnedAt10 = false

    override fun onCreate() {
        super.onCreate()
        instance = this
        createChannel()
        purgeTemporaryPhotos(this, "service_start")
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
        android.os.Handler(mainLooper).postDelayed({ connectSelectedDevice() }, delayMs)
    }

    @SuppressLint("MissingPermission")
    private fun connectSelectedDevice() {
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
        if (saved.isNullOrBlank()) {
            connecting.set(false)
            updateError("No glasses selected. Open Jarvis, tap Connect glasses, and choose the device you want to use.")
            return
        }
        val selected = runCatching { adapter.getRemoteDevice(saved) }.getOrNull()
        if (selected == null) {
            rejectSelectedDevice("The selected Bluetooth device is no longer available. Scan and choose your glasses again.")
            return
        }
        connect(selected)
    }

    @SuppressLint("MissingPermission")
    private fun connect(device: BluetoothDevice) {
        snapshot = snapshot.copy(address = device.address, deviceName = runCatching { device.name }.getOrNull(), lastError = null)
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_ADDRESS, device.address).apply()
        if (device.bondState == BluetoothDevice.BOND_NONE) {
            val pairingStarted = runCatching { device.createBond() }.getOrDefault(false)
            DaemonLog.add("eyevue: Android pairing ${if (pairingStarted) "started" else "was not required/available"} for selected device")
        }
        synchronized(gattStateLock) {
            if (gatt != null) return
            gatt = device.connectGatt(this, false, callback, BluetoothDevice.TRANSPORT_LE)
        }
    }

    private val callback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(callbackGatt: BluetoothGatt, status: Int, newState: Int) {
            synchronized(gattStateLock) {
                if (this@EyevueGlassesService.gatt !== callbackGatt) return
                if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
                    if (!callbackGatt.discoverServices()) {
                        failGattSetup(callbackGatt, "eyeVue service discovery could not be started; reconnecting.")
                    }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    closeConnection()
                    snapshot = snapshot.copy(connected = false, lastError = if (status == 0) null else "Bluetooth disconnected ($status).")
                    updateNotification("eyeVue disconnected; reconnecting…")
                    scheduleConnect(RECONNECT_MS)
                } else if (status != BluetoothGatt.GATT_SUCCESS) {
                    failGattSetup(callbackGatt, "eyeVue connection failed ($status); reconnecting.")
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(callbackGatt: BluetoothGatt, status: Int) {
            synchronized(gattStateLock) {
                if (this@EyevueGlassesService.gatt !== callbackGatt) return
                val service = callbackGatt.getService(EyevueProtocol.SERVICE_UUID)
                val discoveredWrite = service?.getCharacteristic(EyevueProtocol.COMMAND_WRITE_UUID)
                val discoveredNotify = service?.getCharacteristic(EyevueProtocol.COMMAND_NOTIFY_UUID)
                val discoveredPhotoNotify = service?.getCharacteristic(EyevueProtocol.PHOTO_NOTIFY_UUID)
                if (status != BluetoothGatt.GATT_SUCCESS || discoveredWrite == null || discoveredNotify == null || discoveredPhotoNotify == null) {
                    closeConnection()
                    rejectSelectedDevice("The selected device is not compatible with the eyeVue control service. Scan and choose the glasses' control connection.")
                    return
                }
                write = discoveredWrite
                notify = discoveredNotify
                photoNotify = discoveredPhotoNotify
                if (!enableNotification(callbackGatt, discoveredNotify)) {
                    failGattSetup(callbackGatt, "eyeVue command notifications could not be enabled.")
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onDescriptorWrite(callbackGatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            synchronized(gattStateLock) {
                if (this@EyevueGlassesService.gatt !== callbackGatt) return
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    failGattSetup(callbackGatt, "eyeVue notification setup failed ($status); reconnecting.")
                    return
                }
                if (descriptor.characteristic.uuid == EyevueProtocol.COMMAND_NOTIFY_UUID) {
                    val currentPhotoNotify = photoNotify
                    if (currentPhotoNotify == null || !enableNotification(callbackGatt, currentPhotoNotify)) {
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
        }

        @Deprecated("Deprecated in Java")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            handleNotification(gatt, characteristic, characteristic.value.copyOf())
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            handleNotification(gatt, characteristic, value.copyOf())
        }
    }

    private fun handleNotification(callbackGatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
        var frames = emptyList<EyevueFrame>()
        var photo: ByteArray? = null
        var requestedCapture: PendingEyevuePhotoRequest? = null
        synchronized(gattStateLock) {
            if (gatt !== callbackGatt) return
            if (characteristic.uuid == EyevueProtocol.COMMAND_NOTIFY_UUID) {
                frames = decoder.append(value)
            } else if (characteristic.uuid == EyevueProtocol.PHOTO_NOTIFY_UUID) {
                photo = photoAssembler.append(value)
                if (photo != null) requestedCapture = pendingPhoto.getAndSet(null)
            }
        }
        frames.forEach(::handleFrame)
        photo?.let { saveCapturedPhoto(it, requestedCapture) }
    }

    private fun handleFrame(frame: EyevueFrame) {
        when (frame.commandId) {
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

    private fun saveCapturedPhoto(bytes: ByteArray, requestedCapture: PendingEyevuePhotoRequest?) {
        if (requestedCapture?.timedOut?.get() == true) {
            requestedCapture.latch?.countDown()
            DaemonLog.add("eyevue: discarded quarantined AA15 response from timed-out request")
            return
        }
        val directory = File(cacheDir, "eyevue")
        val file = File(directory, "capture-${System.currentTimeMillis()}.jpg")
        try {
            if ((!directory.exists() && !directory.mkdirs()) || !directory.isDirectory) {
                throw IllegalStateException("eyeVue cache directory is unavailable")
            }
            file.writeBytes(bytes)
        } catch (error: Throwable) {
            deleteFileWithRetry(file.absolutePath, "partial-cache-write")
            val failure = "EYEVUE_IMAGE_CACHE_WRITE_FAILED: The temporary image could not be stored on this device. Free space and retry."
            requestedCapture?.failure?.set(failure)
            requestedCapture?.latch?.countDown()
            snapshot = snapshot.copy(lastError = failure)
            DaemonLog.add("eyevue: photo cache write failed: ${error.message}")
            return
        }
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
        synchronized(gattStateLock) {
            if (gatt == null || snapshot.connected != true) {
                return OpResult(false, error = "EYEVUE_NOT_CONNECTED: The glasses connection is unavailable.")
            }
            if (photoRequest != null && !pendingPhoto.compareAndSet(null, photoRequest)) {
                return OpResult(false, error = "EYEVUE_PHOTO_BUSY: A requested photo is already awaiting its AA15 response.")
            }
            if (!writePacket(packet)) {
                photoRequest?.let { pendingPhoto.compareAndSet(it, null) }
                return OpResult(false, error = "EYEVUE_WRITE_FAILED: The command could not be sent.")
            }
        }
        if (photoRequest != null) {
            android.os.Handler(mainLooper).postDelayed({
                synchronized(gattStateLock) {
                    if (pendingPhoto.get() === photoRequest) {
                        photoRequest.timedOut.set(true)
                        closeConnection(photoRequest)
                        pendingPhoto.compareAndSet(photoRequest, null)
                        updateError("eyeVue photo response timed out; reconnecting before another capture.")
                        scheduleConnect(RECONNECT_MS)
                    }
                }
            }, PHOTO_LATE_RESPONSE_QUARANTINE_MS)
        }
        if (latch != null && !latch.await(30, TimeUnit.SECONDS)) {
            photoRequest?.timedOut?.set(true)
            return OpResult(false, error = "EYEVUE_PHOTO_TIMEOUT: No image arrived within 30 seconds. Ask whether to save/retry or use cloud vision.")
        }
        photoRequest?.failure?.get()?.let { return OpResult(false, error = it) }
        return OpResult(true, status(this).json().put("command", name).put("savePromptRequired", name in setOf("photo", "video_stop", "audio_stop")))
    }

    @SuppressLint("MissingPermission")
    private fun writePacket(packet: ByteArray): Boolean = synchronized(gattStateLock) {
        val currentGatt = gatt ?: return@synchronized false
        val characteristic = write ?: return@synchronized false
        characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        if (Build.VERSION.SDK_INT >= 33) {
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
        synchronized(gattStateLock) {
            if (gatt !== callbackGatt) {
                runCatching { callbackGatt.disconnect(); callbackGatt.close() }
                return
            }
            closeConnection()
            updateError(message)
            scheduleConnect(RECONNECT_MS)
        }
    }

    @SuppressLint("MissingPermission")
    private fun closeConnection(preservePendingPhoto: PendingEyevuePhotoRequest? = null) {
        synchronized(gattStateLock) {
            val abandonedPhoto = pendingPhoto.get()
            if (abandonedPhoto != null && abandonedPhoto !== preservePendingPhoto && pendingPhoto.compareAndSet(abandonedPhoto, null)) {
                abandonedPhoto.failure.compareAndSet(null, "EYEVUE_CONNECTION_LOST: The glasses disconnected before the requested photo arrived.")
                abandonedPhoto.latch?.countDown()
            }
            val closingGatt = gatt
            gatt = null
            write = null
            notify = null
            photoNotify = null
            decoder.reset()
            photoAssembler.reset()
            connecting.set(false)
            snapshot = snapshot.copy(connected = false)
            runCatching { closingGatt?.disconnect(); closingGatt?.close() }
        }
    }

    private fun hasBluetoothPermission() = Companion.hasBluetoothPermission(this)

    private fun rejectSelectedDevice(message: String) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putBoolean(PREF_ENABLED, false)
            .remove(PREF_ADDRESS)
            .apply()
        connecting.set(false)
        snapshot = snapshot.copy(enabled = false, connected = false, address = null, deviceName = null, lastError = message)
        updateNotification(message)
        DaemonLog.add("eyevue: $message")
    }

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
        // Never turn a passive analysis request into an implicit camera action.
        // The server approval gate only authorizes a fresh capture when
        // lookAgain=true is present on the approved operation.
        val takeNew = op.optBoolean("lookAgain", false)
        if (takeNew) {
            val capture = EyevueGlassesService.command(context, "photo", waitForPhoto = true)
            if (!capture.ok) return capture
        }
        val boundImagePath = op.optString("imagePath", "").trim().takeIf { it.isNotEmpty() }
        val imagePath = if (!takeNew && boundImagePath != null) {
            val allowedDirectory = File(context.cacheDir, "eyevue").canonicalFile
            val boundFile = runCatching { File(boundImagePath).canonicalFile }.getOrNull()
                ?: return OpResult(false, error = "EYEVUE_IMAGE_UNAVAILABLE: The captured image path is invalid.")
            if (boundFile.parentFile != allowedDirectory || !boundFile.isFile) {
                return OpResult(false, error = "EYEVUE_IMAGE_UNAVAILABLE: The captured image is no longer available in the device-local cache.")
            }
            boundFile.absolutePath
        } else {
            EyevueGlassesService.status(context).lastPhotoPath
                ?: return OpResult(false, error = "EYEVUE_IMAGE_UNAVAILABLE: No current temporary image. A new wearable capture requires explicit approval; retry with lookAgain only after approval.")
        }
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
