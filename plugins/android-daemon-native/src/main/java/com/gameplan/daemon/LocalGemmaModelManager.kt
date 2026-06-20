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
    private const val EXPECTED_E4B_MIN_BYTES = 3_400_000_000L
    private const val EXPECTED_E4B_MAX_BYTES = 3_900_000_000L

    fun status(context: Context, op: JSONObject): OpResult {
        val model = normalizeModel(op.optString("model", DEFAULT_MODEL))
        val file = modelFile(context, model)
        val modelFileReady = file.exists() && file.isFile && file.length() > 0
        val metadata = readMetadata(context, model)
        val modelRevision = if (modelFileReady) buildModelRevision(context, model, file) else null
        val inference = LocalGemmaInferenceEngine.status()
        val engineLastValidationError = optionalString(metadata, "engineLastValidationError")
        val lastEngineError = optionalString(inference, "lastEngineError")
        val validationError = lastEngineError ?: engineLastValidationError
        val engineValidatedRevision = optionalString(metadata, "engineValidatedRevision")
        val engineValidated = modelFileReady &&
            modelRevision != null &&
            engineValidatedRevision == modelRevision &&
            validationError == null
        val needsEngineValidation = modelFileReady && !engineValidated
        val generationReady = engineValidated
        val sizeBytes = if (modelFileReady) file.length() else 0L
        val sizeLooksPlausible = !modelFileReady || model != DEFAULT_MODEL ||
            sizeBytes in EXPECTED_E4B_MIN_BYTES..EXPECTED_E4B_MAX_BYTES

        return OpResult(
            ok = true,
            data = JSONObject()
                .put("provider", "android-local-gemma")
                .put("runtime", "android-app")
                .put("storageOwner", "jarvis-android-app")
                .put("engine", ENGINE)
                .put("model", model)
                .put("modelPath", file.absolutePath)
                .put("sizeBytes", sizeBytes)
                .put("sourceName", optionalString(metadata, "sourceName") ?: JSONObject.NULL)
                .put("sha256", optionalString(metadata, "sha256") ?: JSONObject.NULL)
                .put("importedAtMs", optionalLong(metadata, "importedAtMs") ?: JSONObject.NULL)
                .put("modelRevision", modelRevision ?: JSONObject.NULL)
                .put("ready", generationReady)
                .put("modelFileReady", modelFileReady)
                .put("engineBundled", true)
                .put("generationReady", generationReady)
                .put("needsModelImport", !modelFileReady)
                .put("needsEngineBundle", false)
                .put("needsEngineValidation", needsEngineValidation)
                .put("engineValidated", engineValidated)
                .put("engineValidatedRevision", engineValidatedRevision ?: JSONObject.NULL)
                .put("engineValidatedAtMs", optionalLong(metadata, "engineValidatedAtMs") ?: JSONObject.NULL)
                .put("engineValidatedBackend", optionalString(metadata, "engineValidatedBackend") ?: JSONObject.NULL)
                .put("engineValidatedSpeculativeDecoding", optionalBoolean(metadata, "engineValidatedSpeculativeDecoding") ?: JSONObject.NULL)
                .put("engineLastValidationError", engineLastValidationError ?: JSONObject.NULL)
                .put("lastEngineError", lastEngineError ?: JSONObject.NULL)
                .put("expectedMinSizeBytes", if (model == DEFAULT_MODEL) EXPECTED_E4B_MIN_BYTES else JSONObject.NULL)
                .put("expectedMaxSizeBytes", if (model == DEFAULT_MODEL) EXPECTED_E4B_MAX_BYTES else JSONObject.NULL)
                .put("modelFileSizeLooksPlausible", sizeLooksPlausible)
                .put("inference", inference)
                .put(
                    "message",
                    statusMessage(
                        modelFileReady = modelFileReady,
                        generationReady = generationReady,
                        needsEngineValidation = needsEngineValidation,
                        sizeLooksPlausible = sizeLooksPlausible,
                        validationError = validationError,
                    )
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
            LocalGemmaInferenceEngine.shutdown()
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
                .put("ready", false)
                .put("modelFileReady", true)
                .put("engineBundled", true)
                .put("generationReady", false)
                .put("needsModelImport", false)
                .put("needsEngineBundle", false)
                .put("needsEngineValidation", true)
                .put("engineValidated", false)
                .put("engineValidatedRevision", JSONObject.NULL)
                .put("engineValidatedAtMs", JSONObject.NULL)
                .put("engineValidatedBackend", JSONObject.NULL)
                .put("engineValidatedSpeculativeDecoding", JSONObject.NULL)
                .put("engineLastValidationError", JSONObject.NULL)
            metadataFile(context, model).writeText(metadata.toString(2))

            status(context, JSONObject().put("model", model))
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

        val modelRevision = buildModelRevision(context, model, file)
        val metadata = readMetadata(context, model)
        val validatedRevision = optionalString(metadata, "engineValidatedRevision")
        val validationError = optionalString(metadata, "engineLastValidationError")
        if (validatedRevision != modelRevision) {
            val lastError = validationError?.let { " Last validation error: $it" } ?: ""
            return OpResult(
                false,
                error = "LOCAL_MODEL_VALIDATION_REQUIRED: Validate Phone Gemma in Android settings before using it for chat.$lastError"
            )
        }

        return LocalGemmaInferenceEngine.generate(context, model, file, modelRevision, op)
    }

    fun validate(context: Context, op: JSONObject): OpResult {
        val model = normalizeModel(op.optString("model", DEFAULT_MODEL))
        val file = modelFile(context, model)
        if (!file.exists() || !file.isFile || file.length() == 0L) {
            return OpResult(
                false,
                error = "LOCAL_MODEL_NOT_READY: Import $model as a .litertlm file in Jarvis Android settings."
            )
        }

        val modelRevision = buildModelRevision(context, model, file)
        val result = LocalGemmaInferenceEngine.validate(context, model, file, modelRevision, op)
        return if (result.ok) {
            markValidationSuccess(context, model, modelRevision, result.data as? JSONObject)
            status(context, JSONObject().put("model", model))
        } else {
            val error = result.error ?: "Phone Gemma LiteRT-LM validation failed."
            if (!shouldPreserveExistingValidation(error)) {
                markValidationError(context, model, modelRevision, error)
            }
            result
        }
    }

    fun cancel(op: JSONObject): OpResult {
        return LocalGemmaInferenceEngine.cancel(op)
    }

    private fun normalizeModel(raw: String): String {
        val value = raw.ifBlank { DEFAULT_MODEL }.removePrefix("android-local-gemma/")
        return value.replace(Regex("[^A-Za-z0-9._-]"), "_")
    }

    private fun buildModelRevision(context: Context, model: String, file: File): String {
        val metadataSha = readMetadata(context, model)
            ?.optString("sha256")
            ?.takeIf { it.isNotBlank() }
        val fileRevision = "bytes=${file.length()};modified=${file.lastModified()}"
        return if (metadataSha != null) {
            "sha256=$metadataSha;$fileRevision"
        } else {
            fileRevision
        }
    }

    private fun statusMessage(
        modelFileReady: Boolean,
        generationReady: Boolean,
        needsEngineValidation: Boolean,
        sizeLooksPlausible: Boolean,
        validationError: String?,
    ): String {
        if (!modelFileReady) {
            return "Import a .litertlm Gemma model file in Jarvis Android settings before local generation."
        }
        if (!sizeLooksPlausible) {
            return "Phone Gemma's model file is imported, but its size does not match the expected Gemma 4 E4B LiteRT-LM file. Reimport the official Android .litertlm file."
        }
        if (generationReady) {
            return "Phone Gemma's model file is imported and LiteRT-LM validated on this device."
        }
        if (validationError != null) {
            return "Phone Gemma's model file is imported, but LiteRT-LM could not validate it on this device. Reimport the official Android Gemma 4 E4B .litertlm file, or try a smaller Phone Gemma model if GPU validation keeps failing. Last error: $validationError"
        }
        if (needsEngineValidation) {
            return "Phone Gemma's model file is imported. Validate the LiteRT-LM engine before using it for chat."
        }
        return "Phone Gemma is not ready for local generation yet."
    }

    private fun markValidationSuccess(context: Context, model: String, modelRevision: String, validationData: JSONObject?) {
        val metadata = readMetadata(context, model) ?: JSONObject()
        metadata
            .put("provider", "android-local-gemma")
            .put("runtime", "android-app")
            .put("storageOwner", "jarvis-android-app")
            .put("engine", ENGINE)
            .put("model", model)
            .put("ready", true)
            .put("modelFileReady", true)
            .put("engineBundled", true)
            .put("generationReady", true)
            .put("needsModelImport", false)
            .put("needsEngineBundle", false)
            .put("needsEngineValidation", false)
            .put("engineValidated", true)
            .put("engineValidatedRevision", modelRevision)
            .put("engineValidatedAtMs", System.currentTimeMillis())
            .put("engineValidatedBackend", validationData?.optString("backend")?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
            .put("engineValidatedSpeculativeDecoding", validationData?.optBoolean("speculativeDecoding") ?: JSONObject.NULL)
            .put("engineLastValidationError", JSONObject.NULL)
            .put("engineLastValidationRevision", JSONObject.NULL)
            .put("engineLastValidationAtMs", JSONObject.NULL)
        writeMetadata(context, model, metadata)
    }

    private fun markValidationError(context: Context, model: String, modelRevision: String, error: String) {
        val metadata = readMetadata(context, model) ?: JSONObject()
        metadata
            .put("provider", "android-local-gemma")
            .put("runtime", "android-app")
            .put("storageOwner", "jarvis-android-app")
            .put("engine", ENGINE)
            .put("model", model)
            .put("ready", false)
            .put("engineBundled", true)
            .put("generationReady", false)
            .put("needsModelImport", false)
            .put("needsEngineBundle", false)
            .put("needsEngineValidation", true)
            .put("engineValidated", false)
            .put("engineValidatedRevision", JSONObject.NULL)
            .put("engineValidatedAtMs", JSONObject.NULL)
            .put("engineValidatedBackend", JSONObject.NULL)
            .put("engineValidatedSpeculativeDecoding", JSONObject.NULL)
            .put("engineLastValidationError", error)
            .put("engineLastValidationRevision", modelRevision)
            .put("engineLastValidationAtMs", System.currentTimeMillis())
        writeMetadata(context, model, metadata)
    }

    private fun writeMetadata(context: Context, model: String, metadata: JSONObject) {
        val file = metadataFile(context, model)
        file.parentFile?.mkdirs()
        file.writeText(metadata.toString(2))
    }

    private fun optionalString(json: JSONObject?, key: String): String? {
        if (json == null || !json.has(key) || json.isNull(key)) return null
        return json.optString(key).takeIf { it.isNotBlank() && it != "null" }
    }

    private fun optionalLong(json: JSONObject?, key: String): Long? {
        if (json == null || !json.has(key) || json.isNull(key)) return null
        return json.optLong(key, 0L).takeIf { it > 0L }
    }

    private fun optionalBoolean(json: JSONObject?, key: String): Boolean? {
        if (json == null || !json.has(key) || json.isNull(key)) return null
        return json.optBoolean(key)
    }

    private fun shouldPreserveExistingValidation(error: String): Boolean {
        return error.contains("LOCAL_MODEL_BUSY") ||
            error.contains("LOCAL_MODEL_DEVICE_MEMORY_LOW")
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
