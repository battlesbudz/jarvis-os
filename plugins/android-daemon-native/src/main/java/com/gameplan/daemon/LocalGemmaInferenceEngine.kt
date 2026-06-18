package com.gameplan.daemon

import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.SamplerConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

object LocalGemmaInferenceEngine {
    private const val PROVIDER = "android-local-gemma"
    private const val RUNTIME = "android-app"
    private const val DEFAULT_BACKEND = "gpu"
    private const val DEFAULT_CONTEXT_TOKENS = 4096
    private const val DEFAULT_MAX_COMPLETION_TOKENS = 512
    private const val APPROX_CHARS_PER_TOKEN = 4
    private const val DEFAULT_TOP_K = 40
    private const val DEFAULT_TOP_P = 0.95
    private const val DEFAULT_TEMPERATURE = 0.8

    private val engineMutex = Mutex()
    private val generationMutex = Mutex()
    private val activeRequests = ConcurrentHashMap<String, ActiveRequest>()
    private val completedRequests = AtomicLong(0)

    @Volatile private var engineState: EngineState? = null

    fun status(): JSONObject {
        val state = engineState
        return JSONObject()
            .put("engineLoaded", state != null)
            .put("engineModelPath", state?.modelPath ?: JSONObject.NULL)
            .put("engineBackend", state?.backendName ?: JSONObject.NULL)
            .put("engineContextTokens", state?.contextTokens ?: JSONObject.NULL)
            .put("activeRequests", activeRequests.size)
            .put("completedRequests", completedRequests.get())
            .put("supportsCancellation", true)
            .put("supportsStreaming", true)
            .put("streamDelivery", "buffered_result")
            .put("concurrency", "serialized")
    }

    fun generate(context: Context, model: String, modelFile: File, op: JSONObject): OpResult {
        val prompt = op.optString("prompt", "")
        val requestId = op.optString("requestId", "").ifBlank { UUID.randomUUID().toString() }
        val backendName = normalizeBackend(op.optString("backend", DEFAULT_BACKEND))
        val contextTokens = op.optInt("contextTokens", DEFAULT_CONTEXT_TOKENS).coerceIn(512, 32768)
        val maxCompletionTokens = op.optInt("maxTokens", DEFAULT_MAX_COMPLETION_TOKENS).coerceIn(1, 8192)
        val topK = op.optInt("topK", DEFAULT_TOP_K).coerceAtLeast(1)
        val topP = op.optDouble("topP", DEFAULT_TOP_P).coerceIn(0.0, 1.0)
        val temperature = op.optDouble("temperature", DEFAULT_TEMPERATURE).coerceIn(0.0, 2.0)
        val systemInstruction = op.optString("systemInstruction", "").trim()
        val startedAtMs = System.currentTimeMillis()

        if (activeRequests.containsKey(requestId)) {
            return OpResult(false, error = "LOCAL_MODEL_REQUEST_DUPLICATE: requestId is already active.")
        }

        val job = Job()
        val active = ActiveRequest(requestId, model, modelFile.absolutePath, backendName, startedAtMs, job)
        activeRequests[requestId] = active

        return try {
            var finishReason = "stop"
            val text = runBlocking(job) {
                generationMutex.withLock {
                    val engine = ensureEngine(context, modelFile.absolutePath, backendName, contextTokens)
                    engine.createConversation(buildConversationConfig(systemInstruction, topK, topP, temperature))
                        .use { conversation ->
                            active.conversation = conversation
                            val chunks = StringBuilder()
                            conversation.sendMessageAsync(Message.user(prompt))
                                .takeWhile { message ->
                                    val chunk = message.toString()
                                    chunks.append(chunk)
                                    active.lastChunkAtMs = System.currentTimeMillis()
                                    active.outputChars = chunks.length
                                    val reachedCompletionLimit = hasReachedCompletionLimit(chunks, maxCompletionTokens)
                                    if (reachedCompletionLimit) {
                                        finishReason = "length"
                                        conversation.cancelProcess()
                                    }
                                    !reachedCompletionLimit
                                }
                                .collect {}
                            chunks.toString()
                        }
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
                    .put("contextTokens", contextTokens)
                    .put("maxCompletionTokens", maxCompletionTokens)
                    .put("finishReason", finishReason)
                    .put("completionLimitEnforced", true)
                    .put("text", text)
                    .put("outputChars", text.length)
                    .put("durationMs", System.currentTimeMillis() - startedAtMs)
                    .put("streamed", true)
                    .put("streamDelivery", "buffered_result")
                    .put("concurrency", "serialized")
            )
        } catch (e: CancellationException) {
            OpResult(false, error = "LOCAL_MODEL_CANCELLED: request $requestId was cancelled.")
        } catch (e: Throwable) {
            OpResult(false, error = "LOCAL_MODEL_GENERATION_FAILED: ${e.message ?: e.javaClass.simpleName}")
        } finally {
            active.conversation = null
            activeRequests.remove(requestId)
        }
    }

    fun cancel(op: JSONObject): OpResult {
        val requestId = op.optString("requestId", "")
        if (requestId.isBlank()) {
            val cancelled = activeRequests.values.toList().onEach { request ->
                request.conversation?.cancelProcess()
                request.job.cancel()
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
            activeRequests.values.toList().forEach { request ->
                request.conversation?.cancelProcess()
                request.job.cancel()
            }
            activeRequests.values.toList().forEach { it.job.cancelAndJoin() }
            generationMutex.withLock {
                engineMutex.withLock {
                    engineState?.engine?.close()
                    engineState = null
                }
            }
        }
    }

    private suspend fun ensureEngine(context: Context, modelPath: String, backendName: String, contextTokens: Int): Engine {
        val current = engineState
        if (current != null && current.modelPath == modelPath && current.backendName == backendName && current.contextTokens == contextTokens) {
            return current.engine
        }

        return engineMutex.withLock {
            val lockedCurrent = engineState
            if (lockedCurrent != null && lockedCurrent.modelPath == modelPath && lockedCurrent.backendName == backendName && lockedCurrent.contextTokens == contextTokens) {
                return@withLock lockedCurrent.engine
            }

            lockedCurrent?.engine?.close()
            val engine = Engine(
                EngineConfig(
                    modelPath = modelPath,
                    backend = backendFor(backendName),
                    maxNumTokens = contextTokens,
                    cacheDir = File(context.cacheDir, "litert-lm-cache").absolutePath,
                )
            )
            engine.initialize()
            engineState = EngineState(modelPath, backendName, contextTokens, engine)
            engine
        }
    }

    private fun buildConversationConfig(
        systemInstruction: String,
        topK: Int,
        topP: Double,
        temperature: Double,
    ): ConversationConfig {
        val samplerConfig = SamplerConfig(
            topK = topK,
            topP = topP,
            temperature = temperature,
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

    private fun backendFor(backendName: String): Backend {
        return when (backendName) {
            "cpu" -> Backend.CPU()
            "npu" -> Backend.NPU()
            else -> Backend.GPU()
        }
    }

    private fun hasReachedCompletionLimit(chunks: StringBuilder, maxCompletionTokens: Int): Boolean {
        return estimateCompletionTokens(chunks) >= maxCompletionTokens
    }

    private fun estimateCompletionTokens(text: CharSequence): Int {
        if (text.isEmpty()) return 0
        return ((text.length + APPROX_CHARS_PER_TOKEN - 1) / APPROX_CHARS_PER_TOKEN).coerceAtLeast(1)
    }

    private data class EngineState(
        val modelPath: String,
        val backendName: String,
        val contextTokens: Int,
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
