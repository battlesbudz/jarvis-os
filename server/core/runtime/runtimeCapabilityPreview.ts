import {
  summarizeToolCapabilities,
  toolDescriptorsFromAgentTools,
  type AgentToolDescriptorOptions,
  type ToolCapabilitySummary,
} from "../tools";
import type { AgentTool } from "../../agent/types";
import { runRuntimeDryRun, type RuntimeDryRunResult } from "./runtimeDryRun";
import type { RuntimeToolPreflightInput } from "./runtimeToolPreflight";

export interface RuntimeCapabilityPreviewInput extends Omit<RuntimeToolPreflightInput, "availableTools"> {
  agentTools: Array<Pick<AgentTool, "name">>;
  descriptorOverrides?: Record<string, AgentToolDescriptorOptions>;
}

export interface RuntimeCapabilityPreviewResult {
  capabilitySummary: ToolCapabilitySummary;
  dryRun: RuntimeDryRunResult;
}

export function runRuntimeCapabilityPreview(input: RuntimeCapabilityPreviewInput): RuntimeCapabilityPreviewResult {
  const availableTools = toolDescriptorsFromAgentTools(input.agentTools, input.descriptorOverrides);
  return {
    capabilitySummary: summarizeToolCapabilities(availableTools),
    dryRun: runRuntimeDryRun({
      ...input,
      availableTools,
    }),
  };
}
