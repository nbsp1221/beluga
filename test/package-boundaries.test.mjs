import { describe, expect, test } from 'vitest';
import { findBoundaryViolations } from '../scripts/check-boundaries.mjs';

describe('workspace import boundaries', () => {
  test.each([
    [
      'apps/web/src/example.ts',
      "import '../../../packages/client/src/features/trajectory/view.js';",
      'public entry point',
    ],
    [
      'apps/web/src/example.ts',
      "import 'C:/repo/packages/client/src/features/trajectory/view.js';",
      'workspace entry point',
    ],
    [
      'packages/protocol/src/example.ts',
      "export { readFile } from 'node:fs/promises';",
      'wire protocol',
    ],
    [
      'apps/host/src/example.ts',
      "const view = import('@workspace/runtime/react');",
      'Host modules',
    ],
    [
      'packages/client/src/features/chat/example.ts',
      "const load = import('@workspace/client/bootstrap/connected');",
      'product assembly',
    ],
    [
      'packages/client/src/features/chat/example.ts',
      "export * from '../trajectory/view.js';",
      'browser feature’s contract',
    ],
    [
      'packages/host-plugins/src/harness/example.ts',
      "import '../trajectory/store.js';",
      'Trajectory service contract',
    ],
    [
      'apps/web/src/example.ts',
      "import '@workspace/client/src/bootstrap/connected.js';",
      'exported workspace entry point',
    ],
    [
      'packages/client/src/features/chat/example.ts',
      "import '@workspace/host-plugins/http';",
      'Declare the workspace dependency',
    ],
    [
      'packages/host-plugins/src/filesystem/grep.ts',
      "import { createGrepTool } from '@earendil-works/pi-coding-agent';",
      'Tool contracts and Host policy',
    ],
    [
      'packages/host-plugins/src/process/shell.ts',
      "export { runShell } from '../pi/shell.js';",
      'Tool contracts and Host policy',
    ],
    [
      'packages/host-plugins/src/workspace/file-mutations/operations.ts',
      "import { defineTool } from '@flue/runtime';",
      'Tool contracts and Host policy',
    ],
    [
      'packages/host-plugins/src/pi/write.ts',
      "import { workspaceMutationOperations } from '../workspace/file-mutations/operations.js';",
      'Pi adapters must consume operation contracts',
    ],
    [
      'packages/host-plugins/src/pi/grep.ts',
      "import { defineTool } from '@flue/runtime';",
      'Pi adapters must consume operation contracts',
    ],
    [
      'packages/host-plugins/src/agent-capabilities/file/search/host.ts',
      "import { createGrepTool } from '@earendil-works/pi-coding-agent';",
      'Agent registration must use the Pi adapter',
    ],
  ])('rejects a forbidden import in %s', (source, contents, reason) => {
    expect(findBoundaryViolations(source, contents)).toEqual([expect.stringContaining(reason)]);
  });

  test.each([
    ['apps/web/src/product.ts', "const boot = import('@workspace/client/bootstrap/connected');"],
    ['apps/web/vite.config.ts', "import { resolve } from 'node:path';"],
    ['apps/web/src/main.tsx', "import '@workspace/ui/components/button';"],
    [
      'packages/client/src/features/chat/plugin.tsx',
      "import type { Session } from '../conversation/contract.js';",
    ],
    ['packages/host-plugins/src/harness/host.ts', "import '../trajectory/contract.js';"],
    ['packages/host-plugins/src/pi/grep.ts', "import type { Grep } from '../filesystem/grep.js';"],
    [
      'packages/host-plugins/src/agent-capabilities/file/search/host.ts',
      "import { createPiGrep } from '../../../pi/grep.js';",
    ],
    [
      'packages/host-plugins/src/agent-capabilities/file/search/host.ts',
      "import { workspaceToolAccess } from '../../../workspace/tool-access.js';",
    ],
    ['packages/host-plugins/src/filesystem/grep.test.ts', "import { grep } from '../pi/grep.js';"],
    [
      'packages/ui/eslint.config.mjs',
      "import { reactConfig } from '@workspace/tooling-config/eslint';",
    ],
  ])('allows the intended dependency in %s', (source, contents) => {
    expect(findBoundaryViolations(source, contents)).toEqual([]);
  });
});
