package com.gameplan.daemon

import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.ExperimentalFlags
import com.google.ai.edge.litertlm.SamplerConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import com.google.ai.edge.litertlm.Conversation

object LocalGemmaInferenceEngine {
    private const val PROVIDER = "android-local-gemma"
    private const val RUNTIME = "android-app"
    private const val DEFAULT_BACKEND = "gpu"
    private const val DEFAULT_MAX_TOKENS = 512
    private const val DEFAULT_TOP_K = 40
    private const val DEFAULT_TOP_P = 0.95f
    private const val DEFAULT_TEMPERATURE = 0.8f

    private val engineMutex = Mutex()
    private val activeRequests = ConcurrentHashMap<String, ActiveRequest>()
    private val completedRequests = AtomicLong(0)

    @Volatile private var engineState: EngineState? = null

    fun status(): JSONObject {
        val state = engineState
        return JSONObject()
            .put("engineLoaded", state != null)
            .put("engineModelPath", state?.modelPath ?: JSONObject.NULL)
            .put("engineBackend", state?.backendName ?: JSONObject.NULL)
            .put("activeRequests", activeRequests.size)
            .put("completedRequests", completedRequests.get())
            .put("supportsCancellation", true)
            .put("supportsStreaming", true)
            .put("streamDelivery", "buffered_result")
    }

    fun generate(context: Context, model: String, modelFile: File, op: JSONObject): OpResult {
        val prompt = op.optString("prompt", "")
        val requestId = op.optString("requestId", "").ifBlank { UUID.randomUUID().toString() }
        val backendName = op.optString("backend", DEFAULT_BACKEND).lowercase()
        val maxTokens = op.optInt("maxTokens", DEFAULT_MAX_TOKENS).coerceIn(1, 8192)
        val topK = op.optInt("topK", DEFAULT_TOP_K).coerceAtLeast(1)
        val topP = op.optDouble("topP", DEFAULT_TOP_P.toDouble()).toFloat().coerceIn(0.0f, 1.0f)
        val temperature = op.optDouble("temperature", DEFAULT_TEMPERATURE.toDouble()).toFloat().coerceIn(0.0f, 2.0f)
        val systemInstruction = op.optString("systemInstruction", "").trim()
        val startedAtMs = System.currentTimeMillis()

        if (activeRequests.containsKey(requestId)) {
            return OpResult(false, error = "LOCAL_MODEL_REQUEST_DUPLICATE: requestId is already active.")
        }

        val job = Job()
        val active = ActiveRequest(requestId, model, modelFile.absolutePath, backendName, startedAtMs, job)
        activeRequests[requestId] = active

        return try {
            val text = runBlocking(job) {
                ensureEngine(context, modelFile.absolutePath, backendName, maxTokens)
                    .createConversation(buildConversationConfig(systemInstruction, maxTokens, topK, topP, temperature))
                    .use { conversation ->
                        active.conversation = conversation
                        val chunks = StringBuilder()
                        conversation.sendMessageAsync(prompt).collect { message ->
                            val chunk = message.toString()
                            chunks.append(chunk)
                            active.lastChunkAtMs = System.currentTimeMillis()
                            active.outputChars = chunks.length
                        }
                        chunks.toString()
                    }
            }
            completedRequests.incrementAndGet()
            OpResult(
                ok = true,
                data = JSONObject()
                    .put("provider", PROVIDER)
                    .put("runtime", RUNTIME)
                    .put("engine", "litert-lm")
                    .put("model", model)
                    .put("requestId", requestId)
                    .put("backend", backendName)
                    .put("text", text)
                    .put("outputChars", text.length)
                    .put("durationMs", System.currentTimeMillis() - startedAtMs)
                    .put("streamed", true)
                    .put("streamDelivery", "buffered_result")
            )
        } catch (e: CancellationException) {
            OpResult(false, error = "LOCAL_MODEL_CANCELLED: request $requestId was cancelled.")
        } catch (e: Throwable) {
            OpResult(false, error = "LOCAL_MODEL_GENERATION_FAILED: ${e.message ?: e.javaClass.simpleName}")
        } finally {
            activeRequests.remove(requestId)
        }
    }

    fun cancel(op: JSONObject): OpResult {
        val requestId = op.optString("requestId", "")
        if (requestId.isBlank()) {
            val cancelled = activeRequests.values.toList().onEach {
                it.conversation?.cancelProcess()
                it.job.cancel()
            }.size
            return OpResult(
                ok = true,
                data = JSONObject()
                    .put("provider", PROVIDER)
                    .put("runtime", RUNTIME)
                    .put("cancelled", cancelled > 0)
                    .put("cancelledCount", cancelled)
                    .put("message", if (cancelled > 0) "Cancellation requested for all active local Gemma generations." else "No active local Gemma generations.")
            )
        }

        val active = activeRequests[requestId]
        if (active == null) {
            return OpResult(
                ok = true,
                data = JSONObject()
                    .put("provider", PROVIDER)
                    .put("runtime", RUNTIME)
                    .put("requestId", requestId)
                    .put("cancelled", false)
                    .put("message", "No active local Gemma generation matched requestId.")
            )
        }

        active.conversation?.cancelProcess()
        active.job.cancel()
        return OpResult(
            ok = true,
            data = JSONObject()
                .put("provider", PROVIDER)
                .put("runtime", RUNTIME)
                .put("requestId", requestId)
                .put("cancelled", true)
                .put("message", "Cancellation requested for local Gemma generation.")
        )
    }

    fun shutdown() {
        runBlocking {
            activeRequests.values.toList().forEach { it.job.cancelAndJoin() }
            engineMutex.withLock {
                engineState?.engine?.close()
                engineState = null
            }
        }
    }

    private suspend fun ensureEngine(context: Context, modelPath: String, backendName: String, maxTokens: Int): Engine {
        val requestedBackend = normalizeBackend(backendName)
        val current = engineState
        if (current != null && current.modelPath == modelPath && current.backendName == requestedBackend && current.maxTokens == maxTokens) {
            return current.engine
        }

        return engineMutex.withLock {
            val lockedCurrent = engineState
            if (lockedCurrent != null && lockedCurrent.modelPath == modelPath && lockedCurrent.backendName == requestedBackend && lockedCurrent.maxTokens == maxTokens) {
                return@withLock lockedCurrent.engine
            }

            lockedCurrent?.engine?.close()
            val engine = Engine(
                EngineConfig(
                    modelPath = modelPath,
                    backend = backendFor(context, requestedBackend),
                    maxNumTokens = maxTokens,
                    cacheDir = File(context.cacheDir, "litert-lm-cache").absolutePath,
                )
            )
            if (requestedBackend == "gpu") {
                enableSpeculativeDecoding()
            }
            engine.initialize()
            engineState = EngineState(modelPath, requestedBackend, maxTokens, engine)
            engine
        }
    }

    private fun buildConversationConfig(
        systemInstruction: String,
        maxTokens: Int,
        topK: Int,
        topP: Float,
        temperature: Float,
    ): ConversationConfig {
        val samplerConfig = SamplerConfig(
            topK = topK,
            topP = topP.toDouble(),
            temperature = temperature.toDouble(),
        )
        return if (systemInstruction.isNotBlank()) {
            ConversationConfig(
                systemInstruction = Contents.of(systemInstruction),
                samplerConfig = samplerConfig,
            )
        } else {
            ConversationConfig(samplerConfig = samplerConfig)
        }
    }

    private fun normalizeBackend(raw: String): String {
        return when (raw.lowercase()) {
            "cpu", "gpu", "npu" -> raw.lowercase()
            else -> DEFAULT_BACKEND
        }
    }

    private fun backendFor(context: Context, backendName: String): Backend {
        return when (backendName) {
            "cpu" -> Backend.CPU()
            "npu" -> Backend.NPU(nativeLibraryDir = context.applicationInfo.nativeLibraryDir)
            else -> Backend.GPU()
        }
    }

    @OptIn(ExperimentalApi::class)
    private fun enableSpeculativeDecoding() {
        ExperimentalFlags.enableSpeculativeDecoding = true
    }

    private data class EngineState(
        val modelPath: String,
        val backendName: String,
        val maxTokens: Int,
        val engine: Engine,
    )

    private data class ActiveRequest(
        val requestId: String,
        val model: String,
        val modelPath: String,
        val backend: String,
        val startedAtMs: Long,
        val job: Job,
        @Volatile var lastChunkAtMs: Long = 0L,
        @Volatile var outputChars: Int = 0,
        @Volatile var conversation: Conversation? = null,
    )
}
