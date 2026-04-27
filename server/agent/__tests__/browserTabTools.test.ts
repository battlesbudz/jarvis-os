/**
 * Verifies that the legacy browser_tabs tool has been removed and the four
 * individual tab tools (browser_tab_new, browser_tab_list, browser_tab_select,
 * browser_tab_close) are properly registered.
 *
 * Run with:  npx tsx server/agent/__tests__/browserTabTools.test.ts
 *
 * No test framework required — uses Node.js built-in assert/strict.
 */

import assert from "node:assert/strict";
import { ALL_TOOLS } from "../tools/index";
import {
  browserTabNewTool,
  browserTabListTool,
  browserTabSelectTool,
  browserTabCloseTool,
} from "../tools/browserTools";

async function main(): Promise<void> {
  const toolNames = ALL_TOOLS.map((t) => t.name);

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

  console.log("\nAll browser tab tool tests passed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAIL:", err.message);
    process.exit(1);
  });
