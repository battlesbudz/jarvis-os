package com.jarvis.daemon

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OperatorActionTest {

    @Test
    fun parsesTapElementAction() {
        val action = OperatorAction.fromJson(
            JSONObject()
                .put("type", "tap_element")
                .put("elementId", 42)
        )

        assertEquals("tap_element", action.typeName)
        assertEquals(42, (action as OperatorAction.TapElement).elementId)
        assertTrue(action.isMutating)
        assertTrue(action.requiresApprovalHint)
    }

    @Test
    fun rejectsUnknownActionNames() {
        val error = kotlin.runCatching {
            OperatorAction.fromJson(JSONObject().put("type", "launch_missiles"))
        }.exceptionOrNull()

        assertTrue(error is IllegalArgumentException)
        assertTrue(error?.message?.contains("Unsupported operator action") == true)
    }

    @Test
    fun classifiesDoneAndWaitAsNonMutating() {
        val wait = OperatorAction.fromJson(
            JSONObject()
                .put("type", "wait")
                .put("durationMs", 750)
        )
        val done = OperatorAction.fromJson(JSONObject().put("type", "done"))

        assertEquals("wait", wait.typeName)
        assertFalse(wait.isMutating)
        assertFalse(wait.requiresApprovalHint)
        assertEquals("done", done.typeName)
        assertFalse(done.isMutating)
        assertFalse(done.requiresApprovalHint)
    }

    @Test
    fun serializesApprovalHintForMutatingActions() {
        val action = OperatorAction.fromJson(
            JSONObject()
                .put("type", "type_text")
                .put("text", "hello")
                .put("submit", true)
        )

        val json = action.toJson()
        assertEquals("type_text", json.getString("type"))
        assertTrue(json.getBoolean("mutating"))
        assertTrue(json.getBoolean("requiresApprovalHint"))
    }

    @Test
    fun redactsSensitiveScreenElements() {
        val element = ScreenElement(
            id = 7,
            text = "secret-password",
            contentDescription = "password field",
            viewId = "com.example:id/password",
            className = "android.widget.EditText",
            bounds = ScreenBounds(10, 20, 110, 80),
            traits = setOf(ScreenTrait.EDITABLE, ScreenTrait.FOCUSED),
            sensitive = true
        )

        val json = element.toJson()

        assertEquals("[redacted]", json.getString("text"))
        assertEquals("[redacted]", json.getString("contentDescription"))
        assertEquals(true, json.getBoolean("sensitive"))
    }

    @Test
    fun preservesNonSensitiveLabelsAndContextShape() {
        val element = ScreenElement(
            id = 1,
            text = "Search",
            contentDescription = null,
            viewId = "com.example:id/search",
            className = "android.widget.Button",
            bounds = ScreenBounds(0, 0, 100, 50),
            traits = setOf(ScreenTrait.CLICKABLE, ScreenTrait.ENABLED),
            sensitive = false
        )
        val snapshot = ScreenContextSnapshot(
            generatedAtMs = 1234L,
            foregroundPackage = "com.example",
            foregroundActivity = "MainActivity",
            screenWidth = 1080,
            screenHeight = 2400,
            elements = listOf(element),
            riskHints = listOf("coordinate_fallback_available"),
            warnings = emptyList()
        )

        val json = snapshot.toJson()

        assertEquals(1234L, json.getLong("generatedAtMs"))
        assertEquals("com.example", json.getString("foregroundPackage"))
        assertEquals(1, json.getJSONArray("elements").length())
        assertEquals("Search", json.getJSONArray("elements").getJSONObject(0).getString("text"))
        assertEquals("coordinate_fallback_available", json.getJSONArray("riskHints").getString(0))
    }
}
