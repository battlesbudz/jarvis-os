package com.gameplan.daemon

import org.json.JSONObject

class OperatorActionExecutor(private val service: JarvisAccessibilityService) {

    fun execute(action: OperatorAction): JSONObject {
        return when (action) {
            is OperatorAction.TapElement -> tapElement(action)
            is OperatorAction.TapCoordinates -> {
                service.performTap(action.x.toFloat(), action.y.toFloat())
                ok(JSONObject().put("x", action.x).put("y", action.y))
            }
            is OperatorAction.TypeText -> {
                val typed = service.typeText(action.text, action.submit)
                if (typed) {
                    ok(JSONObject().put("typed", action.text.length).put("submitted", action.submit))
                } else {
                    fail("No editable field found. Tap a text input first, then type.")
                }
            }
            is OperatorAction.Swipe -> {
                service.performSwipe(
                    action.x1.toFloat(),
                    action.y1.toFloat(),
                    action.x2.toFloat(),
                    action.y2.toFloat(),
                    action.durationMs
                )
                ok(
                    JSONObject()
                        .put("x1", action.x1)
                        .put("y1", action.y1)
                        .put("x2", action.x2)
                        .put("y2", action.y2)
                        .put("durationMs", action.durationMs)
                )
            }
            is OperatorAction.PressKey -> {
                val pressed = service.pressKey(action.key)
                if (pressed) ok(JSONObject().put("key", action.key)) else fail("Unsupported key: ${action.key}")
            }
            is OperatorAction.OpenApp -> {
                val launched = service.launchApp(action.packageName)
                if (launched) ok(JSONObject().put("packageName", action.packageName)) else fail("Could not launch ${action.packageName}")
            }
            is OperatorAction.Wait -> {
                val duration = action.durationMs.coerceIn(0L, 10_000L)
                Thread.sleep(duration)
                ok(JSONObject().put("durationMs", duration))
            }
            OperatorAction.Done -> ok(JSONObject().put("done", true))
        }
    }

    private fun tapElement(action: OperatorAction.TapElement): JSONObject {
        val snapshot = service.captureScreenContext()
        val element = snapshot.elements.firstOrNull { it.id == action.elementId }
            ?: return fail("Element id ${action.elementId} was not found in the current screen context")
        if (!element.traits.contains(ScreenTrait.ENABLED)) {
            return fail("Element id ${action.elementId} is disabled")
        }
        service.performTap(element.bounds.centerX.toFloat(), element.bounds.centerY.toFloat())
        return ok(
            JSONObject()
                .put("elementId", element.id)
                .put("x", element.bounds.centerX)
                .put("y", element.bounds.centerY)
                .put("sensitiveTarget", element.sensitive)
        )
    }

    private fun ok(data: JSONObject): JSONObject =
        JSONObject()
            .put("ok", true)
            .put("data", data)

    private fun fail(error: String): JSONObject =
        JSONObject()
            .put("ok", false)
            .put("error", error)
}
