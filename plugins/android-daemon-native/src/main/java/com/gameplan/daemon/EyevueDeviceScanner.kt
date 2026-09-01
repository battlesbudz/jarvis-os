package com.gameplan.daemon

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One-shot, user-facing BLE discovery for the eyeVue setup flow.
 *
 * Discovery intentionally returns every named or bonded device. Jarvis never
 * guesses which nearby accessory is the user's glasses; the user chooses one,
 * and EyevueGlassesService verifies the required AA12 GATT service before it
 * considers the selection connected.
 */
object EyevueDeviceScanner {
    private const val SCAN_DURATION_MS = 8_000L
    private val scanInProgress = AtomicBoolean(false)

    @SuppressLint("MissingPermission")
    fun scan(context: Context, finished: (Result<JSONObject>) -> Unit) {
        if (!EyevueGlassesService.hasBluetoothPermission(context)) {
            finished(Result.failure(IllegalStateException("Grant Nearby Devices before scanning for glasses.")))
            return
        }
        if (!scanInProgress.compareAndSet(false, true)) {
            finished(Result.failure(IllegalStateException("A Bluetooth device scan is already running.")))
            return
        }

        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = manager?.adapter
        if (adapter == null || !adapter.isEnabled) {
            scanInProgress.set(false)
            finished(Result.failure(IllegalStateException("Turn on Bluetooth before scanning for glasses.")))
            return
        }

        val devices = linkedMapOf<String, JSONObject>()
        adapter.bondedDevices.forEach { device ->
            devices[device.address] = deviceJson(device, rssi = null, advertisedAa12 = false)
        }

        val scanner = adapter.bluetoothLeScanner
        if (scanner == null) {
            scanInProgress.set(false)
            finished(Result.success(resultJson(devices.values)))
            return
        }

        val handler = Handler(Looper.getMainLooper())
        lateinit var callback: ScanCallback
        val complete = Runnable {
            if (scanInProgress.compareAndSet(true, false)) {
                runCatching { scanner.stopScan(callback) }
                finished(Result.success(resultJson(devices.values)))
            }
        }

        callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val record = result.scanRecord
                val name = record?.deviceName ?: runCatching { result.device.name }.getOrNull()
                val existing = devices[result.device.address]
                val advertisedAa12 = record?.serviceUuids?.any { it.uuid == EyevueProtocol.SERVICE_UUID } == true
                devices[result.device.address] = deviceJson(
                    result.device,
                    result.rssi,
                    advertisedAa12,
                    name ?: existing?.optString("name")?.takeIf { it.isNotBlank() },
                )
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>) {
                results.forEach { onScanResult(0, it) }
            }

            override fun onScanFailed(errorCode: Int) {
                if (scanInProgress.compareAndSet(true, false)) {
                    finished(Result.failure(IllegalStateException("Bluetooth scan failed ($errorCode).")))
                }
            }
        }

        runCatching { scanner.startScan(callback) }
            .onFailure {
                scanInProgress.set(false)
                finished(Result.failure(it))
                return
            }
        handler.postDelayed(complete, SCAN_DURATION_MS)
    }

    @SuppressLint("MissingPermission")
    private fun deviceJson(
        device: BluetoothDevice,
        rssi: Int?,
        advertisedAa12: Boolean,
        discoveredName: String? = null,
    ) = JSONObject()
        .put("address", device.address)
        .put("name", discoveredName ?: runCatching { device.name }.getOrNull() ?: "Unnamed Bluetooth device")
        .put("bonded", device.bondState == BluetoothDevice.BOND_BONDED)
        .put("pairing", device.bondState == BluetoothDevice.BOND_BONDING)
        .put("rssi", rssi ?: JSONObject.NULL)
        .put("advertisedAa12", advertisedAa12)
        .put("deviceType", when (device.type) {
            BluetoothDevice.DEVICE_TYPE_CLASSIC -> "classic"
            BluetoothDevice.DEVICE_TYPE_LE -> "ble"
            BluetoothDevice.DEVICE_TYPE_DUAL -> "dual"
            else -> "unknown"
        })

    private fun resultJson(devices: Collection<JSONObject>): JSONObject {
        val sorted = devices.sortedWith(
            compareByDescending<JSONObject> { it.optBoolean("advertisedAa12") }
                .thenByDescending { it.optBoolean("bonded") }
                .thenByDescending { if (it.isNull("rssi")) Int.MIN_VALUE else it.optInt("rssi") }
                .thenBy { it.optString("name").lowercase() },
        )
        return JSONObject()
            .put("devices", JSONArray(sorted))
            .put("scanDurationMs", SCAN_DURATION_MS)
            .put("selectionRequired", true)
    }
}
