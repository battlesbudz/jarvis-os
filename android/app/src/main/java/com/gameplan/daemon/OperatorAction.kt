package com.gameplan.daemon

import org.json.JSONObject

sealed class OperatorAction(
    val typeName: String,
    val isMutating: Boolean
) {
    val requiresApprovalHint: Boolean
        get() = isMutating

    open fun toJson(): JSONObject =
        JSONObject()
            .put("type", typeName)
            .put("mutating", isMutating)
            .put("requiresApprovalHint", requiresApprovalHint)

    data class TapElement(val elementId: Int) : OperatorAction("tap_element", true) {
        override fun toJson(): JSONObject = super.toJson().put("elementId", elementId)
    }

    data class TapCoordinates(val x: Double, val y: Double) : OperatorAction("tap_coordinates", true) {
        override fun toJson(): JSONObject = super.toJson().put("x", x).put("y", y)
    }

    data class TypeText(val text: String, val submit: Boolean = false) : OperatorAction("type_text", true) {
        override fun toJson(): JSONObject = super.toJson().put("textLength", text.length).put("submit", submit)
    }

    data class Swipe(
        val x1: Double,
        val y1: Double,
        val x2: Double,
        val y2: Double,
        val durationMs: Long = 300L
    ) : OperatorAction("swipe", true) {
        override fun toJson(): JSONObject = super.toJson()
            .put("x1", x1)
            .put("y1", y1)
            .put("x2", x2)
            .put("y2", y2)
            .put("durationMs", durationMs)
    }

    data class PressKey(val key: String) : OperatorAction("press_key", true) {
        override fun toJson(): JSONObject = super.toJson().put("key", key)
    }

    data class OpenApp(val packageName: String) : OperatorAction("open_app", true) {
        override fun toJson(): JSONObject = super.toJson().put("packageName", packageName)
    }

    data class Wait(val durationMs: Long) : OperatorAction("wait", false) {
        override fun toJson(): JSONObject = super.toJson().put("durationMs", durationMs)
    }

    object Done : OperatorAction("done", false)

    companion object {
        private val allowedKeys = setOf("back", "home", "recents", "enter", "notifications")

        fun fromJson(json: JSONObject): OperatorAction {
            val type = json.optString("type").trim()
            if (type.isEmpty()) throw IllegalArgumentException("Operator action type is required")

            return when (type) {
                "tap_element" -> TapElement(json.requiredInt("elementId"))
                "tap_coordinates" -> TapCoordinates(json.requiredDouble("x"), json.requiredDouble("y"))
                "type_text" -> {
                    if (!json.has("text")) throw IllegalArgumentException("text is required for type_text")
                    TypeText(json.optString("text"), json.optBoolean("submit", false))
                }
                "swipe" -> Swipe(
                    json.requiredDouble("x1"),
                    json.requiredDouble("y1"),
                    json.requiredDouble("x2"),
                    json.requiredDouble("y2"),
                    json.optLong("durationMs", 300L).coerceIn(50L, 3_000L)
                )
                "press_key" -> {
                    val key = json.requiredString("key")
                    if (!allowedKeys.contains(key)) {
                        throw IllegalArgumentException("Unsupported press_key value: $key")
                    }
                    PressKey(key)
                }
                "open_app" -> OpenApp(json.requiredString("packageName"))
                "wait" -> Wait(json.optLong("durationMs", 1_000L).coerceIn(0L, 10_000L))
                "done" -> Done
                else -> throw IllegalArgumentException("Unsupported operator action: $type")
            }
        }

        private fun JSONObject.requiredString(name: String): String {
            val value = optString(name).trim()
            if (value.isEmpty()) throw IllegalArgumentException("$name is required")
            return value
        }

        private fun JSONObject.requiredInt(name: String): Int {
            if (!has(name)) throw IllegalArgumentException("$name is required")
            return optInt(name)
        }

        private fun JSONObject.requiredDouble(name: String): Double {
            if (!has(name)) throw IllegalArgumentException("$name is required")
            val value = optDouble(name, Double.NaN)
            if (value.isNaN()) throw IllegalArgumentException("$name must be a number")
            return value
        }
    }
}
