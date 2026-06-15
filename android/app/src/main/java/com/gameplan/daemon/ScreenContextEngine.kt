package com.gameplan.daemon

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

class ScreenContextEngine(
    private val service: JarvisAccessibilityService,
    private val maxDepth: Int = 30,
    private val maxElements: Int = 250
) {
    fun capture(): ScreenContextSnapshot {
        val warnings = mutableListOf<String>()
        val riskHints = linkedSetOf<String>()
        val root = try {
            service.rootInActiveWindow
        } catch (e: Exception) {
            warnings.add("root_unavailable:${e.message ?: "unknown"}")
            null
        }

        val metrics = service.resources.displayMetrics
        if (root == null) {
            return ScreenContextSnapshot(
                generatedAtMs = System.currentTimeMillis(),
                foregroundPackage = null,
                foregroundActivity = null,
                screenWidth = metrics?.widthPixels,
                screenHeight = metrics?.heightPixels,
                elements = emptyList(),
                riskHints = listOf("no_active_window"),
                warnings = warnings.ifEmpty { listOf("no_active_window") }
            )
        }

        val elements = mutableListOf<ScreenElement>()
        var nextId = 1
        var truncated = false

        fun traverse(node: AccessibilityNodeInfo?, depth: Int) {
            if (node == null || depth > maxDepth) return
            try {
                val rect = Rect()
                node.getBoundsInScreen(rect)
                val text = node.text?.toString()?.trim()?.takeIf { it.isNotEmpty() }
                val desc = node.contentDescription?.toString()?.trim()?.takeIf { it.isNotEmpty() }
                val viewId = node.viewIdResourceName?.trim()?.takeIf { it.isNotEmpty() }
                val className = node.className?.toString()?.trim()?.takeIf { it.isNotEmpty() }
                val traits = traitsFor(node)
                val sensitive = isSensitive(node, text, desc, viewId, className)

                if (rect.width() > 0 && rect.height() > 0 &&
                    shouldInclude(text, desc, viewId, className, traits)
                ) {
                    if (elements.size < maxElements) {
                        elements.add(
                            ScreenElement(
                                id = nextId++,
                                text = text,
                                contentDescription = desc,
                                viewId = viewId,
                                className = className,
                                bounds = ScreenBounds(rect.left, rect.top, rect.right, rect.bottom),
                                traits = traits,
                                sensitive = sensitive
                            )
                        )
                    } else {
                        truncated = true
                    }
                }

                if (sensitive) riskHints.add("sensitive_fields_present")
                if (traits.contains(ScreenTrait.SCROLLABLE)) riskHints.add("scrollable_content_present")
                if (traits.contains(ScreenTrait.CLICKABLE)) riskHints.add("coordinate_fallback_available")

                for (i in 0 until node.childCount) {
                    traverse(node.getChild(i), depth + 1)
                }
            } catch (e: Exception) {
                warnings.add("node_traversal_error_depth_$depth:${e.message ?: "unknown"}")
            }
        }

        traverse(root, 0)
        if (truncated) warnings.add("element_limit_reached:$maxElements")
        if (elements.isEmpty()) riskHints.add("empty_accessibility_tree")

        return ScreenContextSnapshot(
            generatedAtMs = System.currentTimeMillis(),
            foregroundPackage = root.packageName?.toString(),
            foregroundActivity = root.className?.toString(),
            screenWidth = metrics?.widthPixels,
            screenHeight = metrics?.heightPixels,
            elements = elements,
            riskHints = riskHints.toList(),
            warnings = warnings
        )
    }

    private fun shouldInclude(
        text: String?,
        desc: String?,
        viewId: String?,
        className: String?,
        traits: Set<ScreenTrait>
    ): Boolean {
        return !text.isNullOrBlank() ||
            !desc.isNullOrBlank() ||
            !viewId.isNullOrBlank() ||
            !className.isNullOrBlank() ||
            traits.isNotEmpty()
    }

    private fun traitsFor(node: AccessibilityNodeInfo): Set<ScreenTrait> {
        val traits = linkedSetOf<ScreenTrait>()
        if (node.isClickable) traits.add(ScreenTrait.CLICKABLE)
        if (node.isLongClickable) traits.add(ScreenTrait.LONG_CLICKABLE)
        if (node.isEditable) traits.add(ScreenTrait.EDITABLE)
        if (node.isFocusable) traits.add(ScreenTrait.FOCUSABLE)
        if (node.isFocused) traits.add(ScreenTrait.FOCUSED)
        if (node.isSelected) traits.add(ScreenTrait.SELECTED)
        if (node.isEnabled) traits.add(ScreenTrait.ENABLED)
        if (node.isScrollable) traits.add(ScreenTrait.SCROLLABLE)
        if (node.isCheckable) traits.add(ScreenTrait.CHECKABLE)
        if (node.isChecked) traits.add(ScreenTrait.CHECKED)
        if (node.isPassword) traits.add(ScreenTrait.PASSWORD)
        return traits
    }

    private fun isSensitive(
        node: AccessibilityNodeInfo,
        text: String?,
        desc: String?,
        viewId: String?,
        className: String?
    ): Boolean {
        if (node.isPassword) return true
        val hint = node.hintText?.toString()
        val haystack = listOfNotNull(text, desc, viewId, className, hint)
            .joinToString(" ")
            .lowercase()
        return listOf(
            "password",
            "passcode",
            "pin",
            "one time code",
            "otp",
            "security code",
            "ssn",
            "social security",
            "card number",
            "credit card"
        ).any { haystack.contains(it) }
    }
}
