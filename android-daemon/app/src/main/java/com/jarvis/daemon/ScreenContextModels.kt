package com.jarvis.daemon

import org.json.JSONArray
import org.json.JSONObject

const val SCREEN_CONTEXT_REDACTED = "[redacted]"

enum class ScreenTrait(val jsonName: String) {
    CLICKABLE("clickable"),
    LONG_CLICKABLE("long_clickable"),
    EDITABLE("editable"),
    FOCUSABLE("focusable"),
    FOCUSED("focused"),
    SELECTED("selected"),
    ENABLED("enabled"),
    SCROLLABLE("scrollable"),
    CHECKABLE("checkable"),
    CHECKED("checked"),
    PASSWORD("password")
}

data class ScreenBounds(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int
) {
    val width: Int get() = (right - left).coerceAtLeast(0)
    val height: Int get() = (bottom - top).coerceAtLeast(0)
    val centerX: Int get() = left + width / 2
    val centerY: Int get() = top + height / 2

    fun toJson(): JSONObject =
        JSONObject()
            .put("left", left)
            .put("top", top)
            .put("right", right)
            .put("bottom", bottom)
            .put("width", width)
            .put("height", height)
            .put("centerX", centerX)
            .put("centerY", centerY)
}

data class ScreenElement(
    val id: Int,
    val text: String?,
    val contentDescription: String?,
    val viewId: String?,
    val className: String?,
    val bounds: ScreenBounds,
    val traits: Set<ScreenTrait>,
    val sensitive: Boolean
) {
    fun toJson(): JSONObject =
        JSONObject()
            .put("id", id)
            .put("label", redactedLabel())
            .put("text", redactForJson(text, sensitive))
            .put("contentDescription", redactForJson(contentDescription, sensitive))
            .put("viewId", viewId ?: JSONObject.NULL)
            .put("className", className ?: JSONObject.NULL)
            .put("bounds", bounds.toJson())
            .put("traits", traitsToJson())
            .put("sensitive", sensitive)

    private fun redactedLabel(): String {
        if (sensitive && (!text.isNullOrBlank() || !contentDescription.isNullOrBlank())) {
            return SCREEN_CONTEXT_REDACTED
        }
        return when {
            !text.isNullOrBlank() -> text
            !contentDescription.isNullOrBlank() -> contentDescription
            !viewId.isNullOrBlank() -> viewId.substringAfterLast("/")
            !className.isNullOrBlank() -> className.substringAfterLast(".")
            else -> ""
        }
    }

    private fun traitsToJson(): JSONArray {
        val arr = JSONArray()
        traits.map { it.jsonName }.sorted().forEach { arr.put(it) }
        return arr
    }
}

data class ScreenContextSnapshot(
    val generatedAtMs: Long,
    val foregroundPackage: String?,
    val foregroundActivity: String?,
    val screenWidth: Int?,
    val screenHeight: Int?,
    val elements: List<ScreenElement>,
    val riskHints: List<String>,
    val warnings: List<String>
) {
    fun toJson(): JSONObject =
        JSONObject()
            .put("generatedAtMs", generatedAtMs)
            .put("foregroundPackage", foregroundPackage ?: JSONObject.NULL)
            .put("foregroundActivity", foregroundActivity ?: JSONObject.NULL)
            .put("screenWidth", screenWidth ?: JSONObject.NULL)
            .put("screenHeight", screenHeight ?: JSONObject.NULL)
            .put("elements", JSONArray().also { arr -> elements.forEach { arr.put(it.toJson()) } })
            .put("riskHints", JSONArray().also { arr -> riskHints.forEach { arr.put(it) } })
            .put("warnings", JSONArray().also { arr -> warnings.forEach { arr.put(it) } })
}

fun redactForJson(value: String?, sensitive: Boolean): Any {
    if (value == null) return JSONObject.NULL
    if (sensitive && value.isNotBlank()) return SCREEN_CONTEXT_REDACTED
    return value
}
