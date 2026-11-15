import type { AgentCapabilityMetadata } from '@workspace/protocol/host';
import type { Plugin, Services } from '@workspace/runtime';
import type { workspaceToolAccess } from '../workspace/tool-access.js';
import type { AgentToolRegistration } from './tool.js';

export interface AgentCapability {
  metadata: AgentCapabilityMetadata;
  createTools(
    this: void,
    access: Pick<ReturnType<typeof workspaceToolAccess>, 'cwd' | 'checkPermission'>,
  ): readonly AgentToolRegistration[];
}

type ServiceName = Extract<keyof Services, string>;

export type CapabilityService = {
  [Name in ServiceName]: Services[Name] extends AgentCapability ? Name : never;
}[ServiceName];

export interface AgentCapabilityPlugin {
  plugin: Plugin;
  service: CapabilityService;
}
