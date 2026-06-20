package com.gameplan.daemon

import android.app.ActivityManager
import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.ExperimentalFlags
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.SamplerConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
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
    private const val DEFAULT_BACKEND = "auto"
    private const val DEFAULT_ALLOW_CPU_FALLBACK = false
    private const val DEFAULT_CONTEXT_TOKENS = 2048
    private const val DEFAULT_MAX_COMPLETION_TOKENS = 128
    private const val MIN_GPU_AVAILABLE_MEMORY_BYTES = 1800L * 1024L * 1024L
    private const val MIN_CPU_AVAILABLE_MEMORY_BYTES = 2800L * 1024L * 1024L
    private const val APPROX_CHARS_PER_TOKEN = 4
    private const val PROMPT_CHARS_PER_CONTEXT_TOKEN = 3
    private const val MIN_PROMPT_CONTEXT_RESERVE_TOKENS = 64
    private const val MIN_TRIMMED_PROMPT_HEAD_CHARS = 256
    private const val DEFAULT_TOP_K = 40
    private const val DEFAULT_TOP_P = 0.95
    private const val DEFAULT_TEMPERATURE = 0.8

    private val engineMutex = Mutex()
    private val generationMutex = Mutex()
    private val activeRequestLock = Any()
    private val activeRequests = ConcurrentHashMap<String, ActiveRequest>()
    private val completedRequests = AtomicLong(0)

    @Volatile private var engineState: EngineState? = null
    @Volatile private var lastEngineError: String? = null

    fun status(): JSONObject {
        val state = engineState
        return JSONObject()
            .put("engineLoaded", state != null)
            .put("engineModelPath", state?.modelPath ?: JSONObject.NULL)
            .put("engineModelRevision", state?.modelRevision ?: JSONObject.NULL)
            .put("engineBackend", state?.backendName ?: JSONObject.NULL)
            .put("engineSpeculativeDecoding", state?.speculativeDecodingEnabled ?: JSONObject.NULL)
            .put("engineContextTokens", state?.contextTokens ?: JSONObject.NULL)
            .put("lastEngineError", lastEngineError ?: JSONObject.NULL)
            .put("defaultCpuFallbackAllowed", DEFAULT_ALLOW_CPU_FALLBACK)
            .put("activeRequests", activeRequests.size)
            .put("completedRequests", completedRequests.get())
            .put("supportsCancellation", true)
            .put("supportsStreaming", true)
            .put("streamDelivery", "buffered_result")
            .put("concurrency", "serialized")
    }

    fun generate(context: Context, model: String, modelFile: File, modelRevision: String, op: JSONObject): OpResult {
        val rawPrompt = op.optString("prompt", "")
        val requestId = op.optString("requestId", "").ifBlank { UUID.randomUUID().toString() }
        var backendName = normalizeBackend(op.optString("backend", DEFAULT_BACKEND))
        val allowCpuFallback = op.optBoolean("allowCpuFallback", DEFAULT_ALLOW_CPU_FALLBACK)
        val contextTokens = op.optInt("contextTokens", DEFAULT_CONTEXT_TOKENS).coerceIn(512, 32768)
        val maxCompletionTokens = op.optInt("maxTokens", DEFAULT_MAX_COMPLETION_TOKENS).coerceIn(1, 8192)
        val prompt = trimPromptForContext(rawPrompt, contextTokens, maxCompletionTokens)
        val keepEngineWarm = op.optBoolean("keepEngineWarm", false)
        val topK = op.optInt("topK", DEFAULT_TOP_K).coerceAtLeast(1)
        val topP = op.optDouble("topP", DEFAULT_TOP_P).coerceIn(0.0, 1.0)
        val temperature = op.optDouble("temperature", DEFAULT_TEMPERATURE).coerceIn(0.0, 2.0)
        val systemInstruction = op.optString("systemInstruction", "").trim()
        val startedAtMs = System.currentTimeMillis()
        val memory = memorySnapshot(context)

        if (activeRequests.containsKey(requestId)) {
            return OpResult(false, error = "LOCAL_MODEL_REQUEST_DUPLICATE: requestId is already active.")
        }
        if (prompt.length != rawPrompt.length) {
            DaemonLog.add("local_gemma: trimmed prompt request=${shortRequestId(requestId)} chars=${rawPrompt.length}->${prompt.length} context=$contextTokens max=$maxCompletionTokens")
        }
        lowMemoryError(memory, backendName)?.let { error ->
            DaemonLog.add("local_gemma: memory low request=${shortRequestId(requestId)} $error")
            return OpResult(false, error = error)
        }

        val job = Job()
        val active = ActiveRequest(requestId, model, modelFile.absolutePath, modelRevision, backendName, startedAtMs, job)
        registerActiveRequest(active)?.let { return it }
        DaemonLog.add(
            "local_gemma: start request=${shortRequestId(requestId)} backend=$backendName cpuFallback=$allowCpuFallback context=$contextTokens max=$maxCompletionTokens promptChars=${prompt.length} availMem=${formatMiB(memory.availableBytes)}MB"
        )

        return try {
            var requestedAttemptBackend = backendName
            var requestedSpeculativeDecoding: Boolean? = null
            var generationRetries = 0
            var generationResult: OpResult? = null
            while (generationResult == null) {
                var resolvedAttemptBackend = requestedAttemptBackend
                var resolvedAttemptSpeculativeDecoding = false
                try {
                    val attempt = runGenerationAttempt(
                        context = context,
                        modelPath = modelFile.absolutePath,
                        modelRevision = modelRevision,
                        backendName = requestedAttemptBackend,
                        allowCpuFallback = allowCpuFallback,
                        speculativeDecodingPreference = requestedSpeculativeDecoding,
                        contextTokens = contextTokens,
                        systemInstruction = systemInstruction,
                        topK = topK,
                        topP = topP,
                        temperature = temperature,
                        active = active,
                        job = job,
                        prompt = prompt,
                        maxCompletionTokens = maxCompletionTokens,
                        onEngineResolved = { resolvedBackend, speculativeDecodingEnabled ->
                            resolvedAttemptBackend = resolvedBackend
                            resolvedAttemptSpeculativeDecoding = speculativeDecodingEnabled
                        },
                    )
                    backendName = attempt.backendName
                    completedRequests.incrementAndGet()
                    generationResult = OpResult(
                        ok = true,
                        data = JSONObject()
                            .put("provider", PROVIDER)
                            .put("runtime", RUNTIME)
                            .put("engine", "litert-lm")
                            .put("model", model)
                            .put("requestId", requestId)
                            .put("backend", backendName)
                            .put("requestedBackend", active.backend)
                            .put("cpuFallbackAllowed", allowCpuFallback)
                            .put("contextTokens", contextTokens)
                            .put("maxCompletionTokens", maxCompletionTokens)
                            .put("inputChars", prompt.length)
                            .put("inputTrimmed", prompt.length != rawPrompt.length)
                            .put("engineKeptWarm", keepEngineWarm)
                            .put("generationRetries", generationRetries)
                            .put("finishReason", attempt.finishReason)
                            .put("completionLimitEnforced", true)
                            .put("text", attempt.text)
                            .put("outputChars", attempt.text.length)
                            .put("durationMs", System.currentTimeMillis() - startedAtMs)
                            .put("streamed", true)
                            .put("streamDelivery", "buffered_result")
                            .put("concurrency", "serialized")
                    ).also {
                        DaemonLog.add(
                            "local_gemma: done request=${shortRequestId(requestId)} backend=$backendName chars=${attempt.text.length} retries=$generationRetries durationMs=${System.currentTimeMillis() - startedAtMs}"
                        )
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    if (resolvedAttemptSpeculativeDecoding) {
                        releaseEngine(clearLastError = false)
                        active.conversation = null
                        generationRetries += 1
                        DaemonLog.add(
                            "local_gemma: retry_standard request=${shortRequestId(requestId)} backend=$resolvedAttemptBackend failure=${formatEngineError(e).take(120)}"
                        )
                        requestedAttemptBackend = resolvedAttemptBackend
                        requestedSpeculativeDecoding = false
                        continue
                    }
                    if (isCpuFallbackCandidate(requestedAttemptBackend, resolvedAttemptBackend)) {
                        releaseEngine(clearLastError = false)
                        active.conversation = null
                        val retryMemory = memorySnapshot(context)
                        if (shouldRetryGenerationOnCpu(requestedAttemptBackend, resolvedAttemptBackend, retryMemory, allowCpuFallback)) {
                            generationRetries += 1
                            DaemonLog.add(
                                "local_gemma: retry_cpu request=${shortRequestId(requestId)} after backend=$resolvedAttemptBackend failure=${formatEngineError(e).take(120)}"
                            )
                            requestedAttemptBackend = "cpu"
                            requestedSpeculativeDecoding = null
                            continue
                        }
                        DaemonLog.add(
                            "local_gemma: skip_cpu_retry request=${shortRequestId(requestId)} cpuFallback=$allowCpuFallback availMem=${formatMiB(retryMemory.availableBytes)}MB minimum=${formatMiB(MIN_CPU_AVAILABLE_MEMORY_BYTES)}MB lowMemory=${retryMemory.lowMemory}"
                        )
                    }
                    throw e
                }
            }
            generationResult
        } catch (e: CancellationException) {
            DaemonLog.add("local_gemma: cancelled request=${shortRequestId(requestId)}")
            OpResult(false, error = "LOCAL_MODEL_CANCELLED: request $requestId was cancelled.")
        } catch (e: Throwable) {
            val detail = e.message ?: e.javaClass.simpleName
            DaemonLog.add("local_gemma: failed request=${shortRequestId(requestId)} $detail")
            OpResult(false, error = "LOCAL_MODEL_GENERATION_FAILED: $detail")
        } finally {
            active.conversation = null
            try {
                if (!keepEngineWarm) {
                    releaseEngine(clearLastError = false)
                }
            } finally {
                activeRequests.remove(requestId)
            }
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
                    lastEngineError = null
                }
            }
        }
    }

    private fun runGenerationAttempt(
        context: Context,
        modelPath: String,
        modelRevision: String,
        backendName: String,
        allowCpuFallback: Boolean,
        speculativeDecodingPreference: Boolean?,
        contextTokens: Int,
        systemInstruction: String,
        topK: Int,
        topP: Double,
        temperature: Double,
        active: ActiveRequest,
        job: Job,
        prompt: String,
        maxCompletionTokens: Int,
        onEngineResolved: (String, Boolean) -> Unit,
    ): GenerationAttemptResult {
        var finishReason = "stop"
        var resolvedBackendName = backendName
        val attemptJob = SupervisorJob(job)
        val text = try {
            runBlocking(attemptJob) {
                generationMutex.withLock {
                    val resolvedEngine = ensureEngine(context, modelPath, modelRevision, backendName, allowCpuFallback, speculativeDecodingPreference, contextTokens, memorySnapshot(context))
                    resolvedBackendName = resolvedEngine.backendName
                    onEngineResolved(resolvedBackendName, resolvedEngine.speculativeDecodingEnabled)
                    resolvedEngine.engine.createConversation(buildConversationConfig(systemInstruction, topK, topP, temperature))
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
        } finally {
            attemptJob.cancel()
        }
        return GenerationAttemptResult(text, resolvedBackendName, finishReason)
    }

    private fun shouldRetryGenerationOnCpu(
        requestedBackendName: String,
        resolvedBackendName: String,
        memory: MemorySnapshot,
        allowCpuFallback: Boolean,
    ): Boolean {
        return allowCpuFallback && isCpuFallbackCandidate(requestedBackendName, resolvedBackendName) && canUseCpuBackend(memory)
    }

    private fun isCpuFallbackCandidate(requestedBackendName: String, resolvedBackendName: String): Boolean {
        return requestedBackendName != "cpu" && resolvedBackendName != "cpu"
    }

    private fun registerActiveRequest(active: ActiveRequest): OpResult? {
        synchronized(activeRequestLock) {
            if (activeRequests.containsKey(active.requestId)) {
                return OpResult(false, error = "LOCAL_MODEL_REQUEST_DUPLICATE: requestId is already active.")
            }
            if (activeRequests.isNotEmpty()) {
                return OpResult(false, error = "LOCAL_MODEL_BUSY: Phone Gemma is already generating. Wait for it to finish or cancel it before sending another message.")
            }
            activeRequests[active.requestId] = active
        }
        return null
    }

    private fun memorySnapshot(context: Context): MemorySnapshot {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            ?: return MemorySnapshot(Long.MAX_VALUE, 0L, false)
        val info = ActivityManager.MemoryInfo()
        manager.getMemoryInfo(info)
        return MemorySnapshot(info.availMem, info.threshold, info.lowMemory)
    }

    private fun lowMemoryError(memory: MemorySnapshot, backendName: String): String? {
        val minimumBytes = minimumAvailableMemoryBytes(backendName)
        val underMinimum = memory.availableBytes != Long.MAX_VALUE && memory.availableBytes < minimumBytes
        if (!memory.lowMemory && !underMinimum) return null
        return "LOCAL_MODEL_DEVICE_MEMORY_LOW: backend=$backendName available=${formatMiB(memory.availableBytes)}MB threshold=${formatMiB(memory.thresholdBytes)}MB minimum=${formatMiB(minimumBytes)}MB lowMemory=${memory.lowMemory}"
    }

    private fun trimPromptForContext(prompt: String, contextTokens: Int, maxCompletionTokens: Int): String {
        val promptTokens = (contextTokens - maxCompletionTokens - MIN_PROMPT_CONTEXT_RESERVE_TOKENS).coerceAtLeast(128)
        val maxPromptChars = promptTokens * PROMPT_CHARS_PER_CONTEXT_TOKEN
        if (prompt.length <= maxPromptChars) return prompt

        val marker = "\n\n[Earlier local prompt text omitted by Jarvis Android to fit the Phone Gemma context window.]\n\n"
        val bodyBudget = maxPromptChars - marker.length
        if (bodyBudget <= MIN_TRIMMED_PROMPT_HEAD_CHARS * 2) {
            return prompt.takeLast(maxPromptChars).trimStart()
        }

        val headChars = (bodyBudget * 0.4)
            .toInt()
            .coerceAtLeast(MIN_TRIMMED_PROMPT_HEAD_CHARS)
            .coerceAtMost(bodyBudget - MIN_TRIMMED_PROMPT_HEAD_CHARS)
        val tailChars = bodyBudget - headChars
        return prompt.take(headChars).trimEnd() + marker + prompt.takeLast(tailChars).trimStart()
    }

    private fun minimumAvailableMemoryBytes(backendName: String): Long {
        return if (backendName == "cpu") MIN_CPU_AVAILABLE_MEMORY_BYTES else MIN_GPU_AVAILABLE_MEMORY_BYTES
    }

    private fun canUseCpuBackend(memory: MemorySnapshot): Boolean {
        return !memory.lowMemory &&
            memory.availableBytes != Long.MAX_VALUE &&
            memory.availableBytes >= MIN_CPU_AVAILABLE_MEMORY_BYTES
    }

    private fun formatMiB(bytes: Long): Long {
        return if (bytes == Long.MAX_VALUE) -1L else bytes / (1024L * 1024L)
    }

    private fun shortRequestId(requestId: String): String {
        return requestId.take(12)
    }

    private fun releaseEngine(clearLastError: Boolean) {
        runBlocking {
            engineMutex.withLock {
                engineState?.let { state ->
                    try { state.engine.close() } catch (_: Throwable) {}
                }
                engineState = null
                if (clearLastError) lastEngineError = null
            }
        }
    }

    private suspend fun ensureEngine(
        context: Context,
        modelPath: String,
        modelRevision: String,
        backendName: String,
        allowCpuFallback: Boolean,
        speculativeDecodingPreference: Boolean?,
        contextTokens: Int,
        memory: MemorySnapshot,
    ): EngineState {
        val candidateBackends = backendCandidates(backendName, memory, allowCpuFallback)
        val reusableBackends = reusableBackendsFor(backendName, candidateBackends)
        val current = engineState
        if (current != null && canReuseEngine(current, modelPath, modelRevision, reusableBackends, speculativeDecodingPreference, contextTokens)) {
            return current
        }

        return engineMutex.withLock {
            val lockedCurrent = engineState
            if (lockedCurrent != null && canReuseEngine(lockedCurrent, modelPath, modelRevision, reusableBackends, speculativeDecodingPreference, contextTokens)) {
                return@withLock lockedCurrent
            }

            val previousEngine = lockedCurrent?.engine
            val failures = mutableListOf<String>()
            var lastFailure: Throwable? = null

            for (candidateBackendName in candidateBackends) {
                if (lockedCurrent != null && canReuseEngine(lockedCurrent, modelPath, modelRevision, listOf(candidateBackendName), speculativeDecodingPreference, contextTokens)) {
                    lastEngineError = null
                    return@withLock lockedCurrent
                }

                for (speculativeDecodingEnabled in speculativeDecodingCandidates(speculativeDecodingPreference)) {
                    var engine: Engine? = null
                    try {
                        configureExperimentalFlags(speculativeDecodingEnabled)
                        val initializedEngine = Engine(
                            EngineConfig(
                                modelPath = modelPath,
                                backend = backendFor(candidateBackendName),
                                maxNumTokens = contextTokens,
                                cacheDir = File(context.cacheDir, "litert-lm-cache").absolutePath,
                            )
                        )
                        engine = initializedEngine
                        initializedEngine.initialize()
                        val nextState = EngineState(modelPath, modelRevision, candidateBackendName, speculativeDecodingEnabled, contextTokens, initializedEngine)
                        engineState = nextState
                        lastEngineError = null
                        previousEngine?.let { previous ->
                            try { previous.close() } catch (_: Throwable) {}
                        }
                        return@withLock nextState
                    } catch (e: Throwable) {
                        lastFailure = e
                        failures.add("$candidateBackendName: ${decodingModeName(speculativeDecodingEnabled)}: ${formatEngineError(e)}")
                        engine?.let { failedEngine ->
                            try { failedEngine.close() } catch (_: Throwable) {}
                        }
                    }
                }
            }

            val skippedCpuFallback = backendName != "cpu" && !candidateBackends.contains("cpu")
            val cpuSkippedDetail = if (skippedCpuFallback) {
                if (!allowCpuFallback) {
                    "; cpu fallback skipped: disabled by default to avoid Android low-memory kills"
                } else {
                    "; cpu fallback skipped: available=${formatMiB(memory.availableBytes)}MB minimum=${formatMiB(MIN_CPU_AVAILABLE_MEMORY_BYTES)}MB lowMemory=${memory.lowMemory}"
                }
            } else {
                ""
            }
            val message = "Failed to create LiteRT-LM engine after trying ${candidateBackends.joinToString(", ")} backend(s): ${failures.joinToString("; ")}$cpuSkippedDetail"
            lastEngineError = message
            throw IllegalStateException(message, lastFailure)
        }
    }

    private fun canReuseEngine(
        state: EngineState,
        modelPath: String,
        modelRevision: String,
        reusableBackends: List<String>,
        speculativeDecodingPreference: Boolean?,
        contextTokens: Int,
    ): Boolean {
        return state.modelPath == modelPath &&
            state.modelRevision == modelRevision &&
            reusableBackends.contains(state.backendName) &&
            (speculativeDecodingPreference == null || state.speculativeDecodingEnabled == speculativeDecodingPreference) &&
            state.contextTokens == contextTokens
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
            "auto", "cpu", "gpu", "npu" -> raw.lowercase()
            else -> DEFAULT_BACKEND
        }
    }

    private fun backendCandidates(backendName: String, memory: MemorySnapshot, allowCpuFallback: Boolean): List<String> {
        val canFallbackToCpu = allowCpuFallback && canUseCpuBackend(memory)
        return when (backendName) {
            "cpu" -> listOf("cpu")
            "npu" -> if (canFallbackToCpu) listOf("npu", "cpu") else listOf("npu")
            "gpu" -> if (canFallbackToCpu) listOf("gpu", "cpu") else listOf("gpu")
            else -> if (canFallbackToCpu) listOf("gpu", "cpu") else listOf("gpu")
        }
    }

    private fun reusableBackendsFor(backendName: String, candidateBackends: List<String>): List<String> {
        return if (backendName == "auto") candidateBackends else listOf(backendName)
    }

    private fun speculativeDecodingCandidates(preference: Boolean?): List<Boolean> {
        return if (preference == false) listOf(false) else listOf(true, false)
    }

    @OptIn(ExperimentalApi::class)
    private fun configureExperimentalFlags(enableSpeculativeDecoding: Boolean) {
        ExperimentalFlags.enableSpeculativeDecoding = enableSpeculativeDecoding
    }

    private fun decodingModeName(enableSpeculativeDecoding: Boolean): String {
        return if (enableSpeculativeDecoding) "mtp" else "standard"
    }

    private fun backendFor(backendName: String): Backend {
        return when (backendName) {
            "cpu" -> Backend.CPU()
            "npu" -> Backend.NPU()
            else -> Backend.GPU()
        }
    }

    private fun formatEngineError(error: Throwable): String {
        return error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
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
        val modelRevision: String,
        val backendName: String,
        val speculativeDecodingEnabled: Boolean,
        val contextTokens: Int,
        val engine: Engine,
    )

    private data class MemorySnapshot(
        val availableBytes: Long,
        val thresholdBytes: Long,
        val lowMemory: Boolean,
    )

    private data class GenerationAttemptResult(
        val text: String,
        val backendName: String,
        val finishReason: String,
    )

    private data class ActiveRequest(
        val requestId: String,
        val model: String,
        val modelPath: String,
        val modelRevision: String,
        val backend: String,
        val startedAtMs: Long,
        val job: Job,
        @Volatile var lastChunkAtMs: Long = 0L,
        @Volatile var outputChars: Int = 0,
        @Volatile var conversation: Conversation? = null,
    )
}
