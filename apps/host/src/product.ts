import type { HttpService } from '@workspace/host-plugins/http';
import type { Plugin } from '@workspace/runtime';
import { fileReadCapability } from '@workspace/host-plugins/agent-capabilities/file/read';
import { fileSearchCapability } from '@workspace/host-plugins/agent-capabilities/file/search';
import { fileWriteCapability } from '@workspace/host-plugins/agent-capabilities/file/write';
import { shellExecCapability } from '@workspace/host-plugins/agent-capabilities/shell';
import { connectionHost } from '@workspace/host-plugins/connection/host';
import { type HarnessOptions, createHarnessHost } from '@workspace/host-plugins/harness/host';
import { createTrajectoryHost } from '@workspace/host-plugins/trajectory/host';
import { workspaceFileAccessPolicy } from '@workspace/host-plugins/workspace/file-mutations/host';
import { createWorkspaceHost, workspaceCatalogPath } from '@workspace/host-plugins/workspace/host';
import initialAgentPreset from './initial-agent-preset.json' with { type: 'json' };

const agentCapabilities = [
  fileReadCapability,
  fileSearchCapability,
  fileWriteCapability,
  shellExecCapability,
];

export interface HostOptions {
  auth?: Plugin;
  harness?: HarnessOptions;
  web?: HttpService;
}

export function hostPlugins(options: HostOptions): Plugin[] {
  const plugins: Plugin[] = [connectionHost];
  if (options.auth) {
    plugins.push(options.auth);
  }
  if (options.harness) {
    plugins.push(
      createWorkspaceHost(workspaceCatalogPath(options.harness.databasePath)),
      workspaceFileAccessPolicy,
      createTrajectoryHost(`${options.harness.databasePath}.trajectory`),
      ...agentCapabilities.map(({ plugin }) => plugin),
      createHarnessHost(
        { ...options.harness, initialAgentPreset },
        agentCapabilities.map(({ service }) => service),
      ),
    );
  }

  return plugins;
}
