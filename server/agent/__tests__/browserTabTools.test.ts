/**
 * Verifies that the legacy browser_tabs tool has been removed and the four
 * individual tab tools (browser_tab_new, browser_tab_list, browser_tab_select,
 * browser_tab_close) are properly registered.
 *
 * Also verifies the permission layer: filterToolsByGroups and wrapToolsForAgent
 * correctly include/exclude the tab tools based on the browser group flag and
 * can_use_browser permission.
 *
 * Run with:  npx tsx server/agent/__tests__/browserTabTools.test.ts
 *
 * No test framework required — uses Node.js built-in assert/strict.
 */

import assert from "node:assert/strict";
import { ALL_TOOLS, filterToolsByGroups } from "../tools/index";
import {
  checkPermission,
  wrapToolsForAgent,
  PermissionDeniedError,
} from "../agentPermissions";
import {
  browserTabNewTool,
  browserTabListTool,
  browserTabSelectTool,
  browserTabCloseTool,
} from "../tools/browserTools";
import type { DiscordAgent, AgentPermissions } from "@shared/schema";
import { DEFAULT_AGENT_PERMISSIONS } from "@shared/schema";

// ── Minimal mock-agent factory ─────────────────────────────────────────────────
// Only id, userId, and permissions are read by agentPermissions.ts.
// All other required DiscordAgent columns are set to safe zero-values.

function makeAgent(permOverrides: Partial<AgentPermissions> = {}): DiscordAgent {
  return {
    id: "test-agent-id",
    userId: "test-user-id",
    name: "Test Agent",
    role: "custom",
    persona: null,
    channelId: null,
    channelName: null,
    isActive: 1,
    loopEnabled: 0,
    loopIntervalMinutes: null,
    loopPrompt: null,
    lastLoopRun: null,
    createdAt: new Date(),
    platforms: ["discord"],
    permissions: { ...DEFAULT_AGENT_PERMISSIONS, ...permOverrides },
    memoryScope: "agent_private",
    accessGlobalMemory: false,
    allowedUsers: [],
    allowedConversations: [],
    privateMode: false,
    platformChannels: {},
    configJson: null,
    lastHeartbeatAt: null,
    stuckSince: null,
    heartbeatFailCount: 0,
    preferredModel: null,
    mentionPatterns: [],
  };
}

const TAB_TOOL_NAMES = [
  "browser_tab_new",
  "browser_tab_list",
  "browser_tab_select",
  "browser_tab_close",
] as const;

async function main(): Promise<void> {
  const toolNames = ALL_TOOLS.map((t) => t.name);

  // ── Registration tests ───────────────────────────────────────────────────────

  // BT-1: legacy browser_tabs tool must not be registered
  {
    assert.ok(
      !toolNames.includes("browser_tabs"),
      "BT-1: browser_tabs must NOT be in ALL_TOOLS",
    );
    console.log("✓ BT-1: legacy browser_tabs is not registered in ALL_TOOLS");
  }

  // BT-2: browser_tab_new is registered
  {
    assert.ok(
      toolNames.includes("browser_tab_new"),
      "BT-2: browser_tab_new must be in ALL_TOOLS",
    );
    console.log("✓ BT-2: browser_tab_new is registered");
  }

  // BT-3: browser_tab_list is registered
  {
    assert.ok(
      toolNames.includes("browser_tab_list"),
      "BT-3: browser_tab_list must be in ALL_TOOLS",
    );
    console.log("✓ BT-3: browser_tab_list is registered");
  }

  // BT-4: browser_tab_select is registered
  {
    assert.ok(
      toolNames.includes("browser_tab_select"),
      "BT-4: browser_tab_select must be in ALL_TOOLS",
    );
    console.log("✓ BT-4: browser_tab_select is registered");
  }

  // BT-5: browser_tab_close is registered
  {
    assert.ok(
      toolNames.includes("browser_tab_close"),
      "BT-5: browser_tab_close must be in ALL_TOOLS",
    );
    console.log("✓ BT-5: browser_tab_close is registered");
  }

  // BT-6: individual tool exports have the correct names
  {
    assert.equal(browserTabNewTool.name, "browser_tab_new", "BT-6a: browserTabNewTool.name");
    assert.equal(browserTabListTool.name, "browser_tab_list", "BT-6b: browserTabListTool.name");
    assert.equal(browserTabSelectTool.name, "browser_tab_select", "BT-6c: browserTabSelectTool.name");
    assert.equal(browserTabCloseTool.name, "browser_tab_close", "BT-6d: browserTabCloseTool.name");
    console.log("✓ BT-6: individual tab tool exports have correct names");
  }

  // BT-7: all four individual tab tools have execute functions
  {
    const tabTools = [browserTabNewTool, browserTabListTool, browserTabSelectTool, browserTabCloseTool];
    for (const tool of tabTools) {
      assert.equal(typeof tool.execute, "function", `BT-7: ${tool.name} must have an execute function`);
    }
    console.log("✓ BT-7: all four individual tab tools have execute functions");
  }

  // ── filterToolsByGroups tests ────────────────────────────────────────────────

  // BP-1: filterToolsByGroups with "browser" includes all four tab tools
  {
    const filtered = filterToolsByGroups(["browser"]);
    const filteredNames = filtered.map((t) => t.name);
    for (const name of TAB_TOOL_NAMES) {
      assert.ok(
        filteredNames.includes(name),
        `BP-1: filterToolsByGroups(["browser"]) must include ${name}`,
      );
    }
    console.log("✓ BP-1: filterToolsByGroups(['browser']) includes all four tab tools");
  }

  // BP-2: filterToolsByGroups without "browser" excludes all four tab tools
  {
    const filtered = filterToolsByGroups(["email", "calendar", "memory"]);
    const filteredNames = filtered.map((t) => t.name);
    for (const name of TAB_TOOL_NAMES) {
      assert.ok(
        !filteredNames.includes(name),
        `BP-2: filterToolsByGroups without browser must NOT include ${name}`,
      );
    }
    console.log("✓ BP-2: filterToolsByGroups without 'browser' excludes all four tab tools");
  }

  // BP-3: filterToolsByGroups with empty groups excludes all four tab tools
  {
    const filtered = filterToolsByGroups([]);
    const filteredNames = filtered.map((t) => t.name);
    for (const name of TAB_TOOL_NAMES) {
      assert.ok(
        !filteredNames.includes(name),
        `BP-3: filterToolsByGroups([]) must NOT include ${name}`,
      );
    }
    console.log("✓ BP-3: filterToolsByGroups([]) excludes all four tab tools");
  }

  // ── checkPermission tests ────────────────────────────────────────────────────

  // BP-4: checkPermission allows all four tab tools when can_use_browser is true
  {
    const agent = makeAgent({ can_use_browser: true });
    for (const name of TAB_TOOL_NAMES) {
      assert.doesNotThrow(
        () => checkPermission(agent, name),
        `BP-4: checkPermission must NOT throw for ${name} when can_use_browser=true`,
      );
    }
    console.log("✓ BP-4: checkPermission allows all tab tools when can_use_browser=true");
  }

  // BP-5: checkPermission throws PermissionDeniedError for each tab tool when can_use_browser is false
  {
    const agent = makeAgent({ can_use_browser: false });
    for (const name of TAB_TOOL_NAMES) {
      let threw = false;
      try {
        checkPermission(agent, name);
      } catch (err) {
        threw = true;
        assert.ok(
          err instanceof PermissionDeniedError,
          `BP-5: error for ${name} must be a PermissionDeniedError`,
        );
        assert.equal(
          (err as PermissionDeniedError).flag,
          "can_use_browser",
          `BP-5: PermissionDeniedError.flag must be "can_use_browser" for ${name}`,
        );
        assert.equal(
          (err as PermissionDeniedError).toolName,
          name,
          `BP-5: PermissionDeniedError.toolName must be "${name}"`,
        );
      }
      assert.ok(threw, `BP-5: checkPermission must throw for ${name} when can_use_browser=false`);
    }
    console.log("✓ BP-5: checkPermission throws PermissionDeniedError for each tab tool when can_use_browser=false");
  }

  // ── wrapToolsForAgent tests ──────────────────────────────────────────────────

  // BP-6: wrapToolsForAgent includes all four tab tools when can_use_browser is true
  {
    const agent = makeAgent({ can_use_browser: true });
    const wrapped = wrapToolsForAgent(ALL_TOOLS, agent);
    const wrappedNames = wrapped.map((t) => t.name);
    for (const name of TAB_TOOL_NAMES) {
      assert.ok(
        wrappedNames.includes(name),
        `BP-6: wrapToolsForAgent must include ${name} when can_use_browser=true`,
      );
    }
    console.log("✓ BP-6: wrapToolsForAgent includes all tab tools when can_use_browser=true");
  }

  // BP-7: wrapToolsForAgent excludes all four tab tools when can_use_browser is false
  {
    const agent = makeAgent({ can_use_browser: false });
    const wrapped = wrapToolsForAgent(ALL_TOOLS, agent);
    const wrappedNames = wrapped.map((t) => t.name);
    for (const name of TAB_TOOL_NAMES) {
      assert.ok(
        !wrappedNames.includes(name),
        `BP-7: wrapToolsForAgent must NOT include ${name} when can_use_browser=false`,
      );
    }
    console.log("✓ BP-7: wrapToolsForAgent excludes all tab tools when can_use_browser=false");
  }

  // BP-8: fail-closed guard — an unclassified tool (not in PERMISSION_TOOL_MAP and
  //       not in ALWAYS_ALLOWED_TOOLS) is denied even when all permission flags are true.
  //       This confirms that removing a tab tool from the permission map would surface
  //       as a PermissionDeniedError with flag="unclassified_tool" rather than silently
  //       passing through.
  {
    const allPermsAgent = makeAgent({
      can_use_browser: true,
      can_search_web: true,
      can_send_emails: true,
      can_read_email: true,
      can_access_files: true,
      can_send_messages: true,
      can_take_screenshots: true,
      can_open_apps: true,
      can_call_user: true,
      can_use_voice: true,
      can_create_tasks: true,
      can_create_other_agents: true,
      can_access_global_memory: true,
    });
    let threw = false;
    try {
      checkPermission(allPermsAgent, "__unclassified_tool_that_does_not_exist__");
    } catch (err) {
      threw = true;
      assert.ok(
        err instanceof PermissionDeniedError,
        "BP-8: unclassified tool must throw PermissionDeniedError",
      );
      assert.equal(
        (err as PermissionDeniedError).flag,
        "unclassified_tool",
        "BP-8: PermissionDeniedError.flag must be 'unclassified_tool' for unregistered tools",
      );
    }
    assert.ok(threw, "BP-8: checkPermission must throw for an unclassified tool even with all flags true");
    console.log("✓ BP-8: fail-closed — unclassified tools are denied even with all flags enabled");
  }

  console.log("\nAll browser tab tool tests passed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAIL:", err.message);
    process.exit(1);
  });
