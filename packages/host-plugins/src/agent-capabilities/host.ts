import type { ToolDefinition } from '@flue/runtime';
import type { AgentCapabilityMetadata } from '@workspace/protocol/host';
import type { Plugin, Services } from '@workspace/runtime';

export interface AgentCapability {
  metadata: AgentCapabilityMetadata;
  createTools(sessionId: string): readonly ToolDefinition[];
}

type ServiceName = Extract<keyof Services, string>;

export type CapabilityService = {
  [Name in ServiceName]: Services[Name] extends AgentCapability ? Name : never;
}[ServiceName];

export interface AgentCapabilityPlugin {
  plugin: Plugin;
  service: CapabilityService;
}
