package com.jarvis.daemon

object JarvisConfig {
    const val SERVER_URL = "https://gameplanjarvisai.up.railway.app"

    private val LEGACY_REPLIT_MARKERS = listOf(
        "replit",
        "repl.co",
        "replit.app",
        "repl.it"
    )

    fun normalizeServerUrl(value: String?): String {
        val trimmed = value?.trim()?.trimEnd('/') ?: ""
        if (trimmed.isEmpty()) return SERVER_URL

        val lower = trimmed.lowercase()
        return if (LEGACY_REPLIT_MARKERS.any { lower.contains(it) }) {
            SERVER_URL
        } else {
            trimmed
        }
    }
}
