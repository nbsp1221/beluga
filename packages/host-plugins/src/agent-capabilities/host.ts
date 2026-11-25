import type { AgentCapabilityMetadata } from '@workspace/protocol/host';
import type { Plugin, Services } from '@workspace/runtime';
import type { workspaceToolAccess } from '../workspace/tool-access.js';
import type { AgentToolRegistration, OnFiles } from './tool.js';

export type AgentCapability = AgentToolCapability | AgentContextCapability;

interface AgentToolCapability {
  metadata: AgentCapabilityMetadata;
  createTools(
    this: void,
    access: Pick<ReturnType<typeof workspaceToolAccess>, 'cwd' | 'checkPermission'>,
  ): readonly AgentToolRegistration[];
}

interface AgentContextCapability {
  metadata: AgentCapabilityMetadata;
  useContext(
    cwd: string | undefined,
    sessionId: string,
  ): {
    onFiles: OnFiles;
  };
}

type ServiceName = Extract<keyof Services, string>;

export type CapabilityService = {
  [Name in ServiceName]: Services[Name] extends AgentCapability ? Name : never;
}[ServiceName];

export interface AgentCapabilityPlugin {
  plugin: Plugin;
  service: CapabilityService;
}
