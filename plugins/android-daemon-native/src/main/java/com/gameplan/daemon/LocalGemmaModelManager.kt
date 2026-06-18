package com.gameplan.daemon

import android.content.Context
import android.os.Build
import android.os.Environment
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

object LocalGemmaModelManager {
    private const val DEFAULT_MODEL = "gemma-4-e4b-it"
    private const val ENGINE = "litert-lm"
    private const val DEFAULT_DOWNLOAD_FILE = "gemma-4-E4B-it.litertlm"
    private const val COPY_BUFFER_BYTES = 1024 * 1024
    private const val ENGINE_NOT_BUNDLED_MESSAGE =
        "Phone Gemma's model file is imported, but this APK does not bundle LiteRT-LM generation yet."

    fun status(context: Context, op: JSONObject): OpResult {
        val model = normalizeModel(op.optString("model", DEFAULT_MODEL))
        val file = modelFile(context, model)
        val modelFileReady = file.exists() && file.isFile && file.length() > 0
        val metadata = readMetadata(context, model)
        return OpResult(
            ok = true,
            data = JSONObject()
                .put("provider", "android-local-gemma")
                .put("runtime", "android-app")
                .put("storageOwner", "jarvis-android-app")
                .put("engine", ENGINE)
                .put("model", model)
                .put("modelPath", file.absolutePath)
                .put("sizeBytes", if (modelFileReady) file.length() else 0L)
                .put("sourceName", metadata?.optString("sourceName")?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
                .put("sha256", metadata?.optString("sha256")?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
                .put("importedAtMs", metadata?.optLong("importedAtMs", 0L)?.takeIf { it > 0 } ?: JSONObject.NULL)
                .put("ready", false)
                .put("modelFileReady", modelFileReady)
                .put("engineBundled", false)
                .put("generationReady", false)
                .put("needsModelImport", !modelFileReady)
                .put("needsEngineBundle", modelFileReady)
                .put(
                    "message",
                    if (modelFileReady) {
                        ENGINE_NOT_BUNDLED_MESSAGE
                    } else {
                        "Import a .litertlm Gemma model file in Jarvis Android settings before local generation."
                    }
                )
        )
    }

    fun importModel(context: Context, op: JSONObject): OpResult {
        val model = normalizeModel(op.optString("model", DEFAULT_MODEL))
        val sourceResult = resolveImportSource(op)
        val source = sourceResult.file
            ?: return OpResult(false, error = sourceResult.error ?: "LOCAL_MODEL_IMPORT_SOURCE_NOT_FOUND")

        if (!source.name.endsWith(".litertlm", ignoreCase = true)) {
            return OpResult(false, error = "LOCAL_MODEL_IMPORT_BAD_FILE: Select a .litertlm model file.")
        }
        if (!source.exists() || !source.isFile || source.length() == 0L) {
            return OpResult(false, error = "LOCAL_MODEL_IMPORT_SOURCE_NOT_FOUND: ${source.absolutePath}")
        }

        val target = modelFile(context, model)
        val targetDir = target.parentFile
            ?: return OpResult(false, error = "LOCAL_MODEL_IMPORT_TARGET_INVALID")
        if (!targetDir.exists() && !targetDir.mkdirs()) {
            return OpResult(false, error = "LOCAL_MODEL_IMPORT_TARGET_FAILED: Could not create ${targetDir.absolutePath}.")
        }

        val tmp = File(targetDir, "model.litertlm.tmp")
        return try {
            if (tmp.exists()) tmp.delete()
            val sha256 = copyWithSha256(source, tmp)
            if (target.exists() && !target.delete()) {
                tmp.delete()
                return OpResult(false, error = "LOCAL_MODEL_IMPORT_TARGET_FAILED: Could not replace existing model file.")
            }
            if (!tmp.renameTo(target)) {
                tmp.copyTo(target, overwrite = true)
                tmp.delete()
            }
            val metadata = JSONObject()
                .put("provider", "android-local-gemma")
                .put("runtime", "android-app")
                .put("storageOwner", "jarvis-android-app")
                .put("engine", ENGINE)
                .put("model", model)
                .put("sourceName", source.name)
                .put("sourcePath", source.absolutePath)
                .put("targetPath", target.absolutePath)
                .put("sizeBytes", target.length())
                .put("sha256", sha256)
                .put("importedAtMs", System.currentTimeMillis())
            metadataFile(context, model).writeText(metadata.toString(2))

            OpResult(
                ok = true,
                data = JSONObject()
                    .put("provider", "android-local-gemma")
                    .put("runtime", "android-app")
                    .put("storageOwner", "jarvis-android-app")
                    .put("engine", ENGINE)
                    .put("model", model)
                    .put("sourcePath", source.absolutePath)
                    .put("modelPath", target.absolutePath)
                    .put("sizeBytes", target.length())
                    .put("sha256", sha256)
                    .put("ready", false)
                    .put("modelFileReady", true)
                    .put("engineBundled", false)
                    .put("generationReady", false)
                    .put("needsModelImport", false)
                    .put("needsEngineBundle", true)
                    .put("message", ENGINE_NOT_BUNDLED_MESSAGE)
            )
        } catch (se: SecurityException) {
            tmp.delete()
            OpResult(
                false,
                error = "LOCAL_MODEL_STORAGE_PERMISSION_REQUIRED: Enable All files access for Jarvis Android, then retry the import."
            )
        } catch (e: Exception) {
            tmp.delete()
            OpResult(false, error = "LOCAL_MODEL_IMPORT_FAILED: ${e.message}")
        }
    }

    fun generate(context: Context, op: JSONObject): OpResult {
        val model = normalizeModel(op.optString("model", DEFAULT_MODEL))
        val prompt = op.optString("prompt", "")
        if (prompt.isBlank()) {
            return OpResult(false, error = "LOCAL_MODEL_BAD_REQUEST: prompt required")
        }

        val file = modelFile(context, model)
        if (!file.exists() || !file.isFile || file.length() == 0L) {
            return OpResult(
                false,
                error = "LOCAL_MODEL_NOT_READY: Import $model as a .litertlm file in Jarvis Android settings."
            )
        }

        return OpResult(
            false,
            error = "LOCAL_MODEL_ENGINE_NOT_BUNDLED: LiteRT-LM generation is not bundled in this APK yet. The model file is present, but Jarvis cannot run inference until the LiteRT-LM Android dependency is wired."
        )
    }

    fun cancel(op: JSONObject): OpResult {
        val requestId = op.optString("requestId", "")
        return OpResult(
            ok = true,
            data = JSONObject()
                .put("provider", "android-local-gemma")
                .put("runtime", "android-app")
                .put("requestId", requestId)
                .put("cancelled", false)
                .put("message", "No active LiteRT-LM generation request is registered in this build.")
        )
    }

    private fun normalizeModel(raw: String): String {
        val value = raw.ifBlank { DEFAULT_MODEL }.removePrefix("android-local-gemma/")
        return value.replace(Regex("[^A-Za-z0-9._-]"), "_")
    }

    private data class ImportSourceResult(val file: File?, val error: String? = null)

    private fun resolveImportSource(op: JSONObject): ImportSourceResult {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
            return ImportSourceResult(
                null,
                "LOCAL_MODEL_STORAGE_PERMISSION_REQUIRED: Enable All files access for Jarvis Android before importing from Downloads."
            )
        }

        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val sourcePath = op.optString("sourcePath", "").trim()
        val explicitSource = if (sourcePath.isNotBlank()) File(sourcePath) else null
        if (explicitSource != null) {
            return if (isUnderDirectory(explicitSource, downloadsDir)) {
                ImportSourceResult(explicitSource)
            } else {
                ImportSourceResult(
                    null,
                    "LOCAL_MODEL_IMPORT_BAD_PATH: Import source must be inside Android Downloads."
                )
            }
        }

        val requestedName = File(op.optString("fileName", "").trim()).name
        val candidateNames = listOf(
            requestedName,
            DEFAULT_DOWNLOAD_FILE,
            "gemma-4-e4b-it.litertlm",
            "model.litertlm",
        ).filter { it.isNotBlank() }.distinct()

        for (name in candidateNames) {
            val candidate = File(downloadsDir, name)
            if (candidate.exists() && candidate.isFile) return ImportSourceResult(candidate)
        }

        val discovered = try {
            downloadsDir.listFiles { file ->
                file.isFile &&
                    file.name.endsWith(".litertlm", ignoreCase = true) &&
                    file.name.contains("gemma", ignoreCase = true) &&
                    file.name.contains("e4b", ignoreCase = true)
            }?.maxByOrNull { it.lastModified() }
        } catch (e: Exception) {
            null
        }
        if (discovered != null) return ImportSourceResult(discovered)

        return ImportSourceResult(
            null,
            "LOCAL_MODEL_IMPORT_SOURCE_NOT_FOUND: Put $DEFAULT_DOWNLOAD_FILE in Downloads, then retry."
        )
    }

    private fun isUnderDirectory(file: File, directory: File): Boolean {
        val root = directory.canonicalFile
        val child = file.canonicalFile
        return child.path == root.path || child.path.startsWith(root.path + File.separator)
    }

    private fun copyWithSha256(source: File, target: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(COPY_BUFFER_BYTES)
        BufferedInputStream(source.inputStream(), COPY_BUFFER_BYTES).use { input ->
            FileOutputStream(target).use { output ->
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (read == 0) continue
                    digest.update(buffer, 0, read)
                    output.write(buffer, 0, read)
                }
            }
        }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }

    private fun readMetadata(context: Context, model: String): JSONObject? {
        val file = metadataFile(context, model)
        if (!file.exists() || !file.isFile) return null
        return try {
            JSONObject(file.readText())
        } catch (e: Exception) {
            null
        }
    }

    @JvmStatic
    fun modelFile(context: Context, model: String): File {
        return File(modelDir(context, normalizeModel(model)), "model.litertlm")
    }

    private fun metadataFile(context: Context, model: String): File {
        return File(modelDir(context, model), "metadata.json")
    }

    private fun modelDir(context: Context, model: String): File {
        return File(context.filesDir, "local_models/$model")
    }
}
