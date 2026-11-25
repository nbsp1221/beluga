import {
  type AgentStartContext,
  useAgentStart,
  useDelivery,
  useDispatchMessage,
  usePersistentState,
} from '@flue/runtime';
import type { AgentCapability, AgentCapabilityPlugin } from '../agent-capabilities/host.js';
import {
  type InstructionOptions,
  type InstructionState,
  WorkspaceInstructionsRootError,
  diffInstructions,
  discoverTouchedInstructions,
  initialInstructions,
  instructionVersions,
  refreshInstructions,
  resolveInstructionRoot,
  visibleInstructionVersions,
} from './discovery.js';

const id = 'agent-instructions';
const unavailableRoot = 'workspace-instructions-root-unavailable';

declare module '@workspace/runtime' {
  interface Services {
    agentInstructions: AgentCapability;
  }
}

export function agentInstructionsCapability(
  directory: string,
  options: InstructionOptions = {},
): AgentCapabilityPlugin {
  return {
    service: 'agentInstructions',
    plugin: {
      id,
      requires: ['workspaceFiles'],
      provides: ['agentInstructions'],
      setup(context) {
        const files = context.get('workspaceFiles');
        const instance = crypto.randomUUID();
        const pendingUpdates = new Map<string, Promise<void>>();

        function queueUpdate(sessionId: string, run: () => Promise<void>) {
          const update = (pendingUpdates.get(sessionId) ?? Promise.resolve()).then(run);
          const tail = update.catch(() => {});
          pendingUpdates.set(sessionId, tail);
          return update.finally(() => {
            if (pendingUpdates.get(sessionId) === tail) {
              pendingUpdates.delete(sessionId);
            }
          });
        }

        context.provide('agentInstructions', {
          metadata: {
            id,
            name: 'Workspace instructions',
            description: 'Load AGENTS.md guidance relevant to the conversation’s workspace.',
          },
          useContext(cwd, sessionId) {
            const delivery = useDelivery();
            const dispatch = useDispatchMessage();
            const [state, setState] = usePersistentState<InstructionState>(
              'workspace-context',
              initialInstructions,
            );
            let current = state;

            async function reconcile(
              { append, contextSignals, signal }: AgentStartContext,
              restoring = false,
            ) {
              if (!cwd) {
                return;
              }
              const visible = visibleInstructionVersions(contextSignals(id));
              const known = instructionVersions(current);
              const missingContext =
                visible.size !== known.size ||
                [...known].some(([path, digest]) => visible.get(path) !== digest);
              if (restoring && !missingContext) {
                return;
              }
              const root = await resolveInstructionRoot(files, cwd, signal, options);
              if (current.instance === instance && current.root === root && !missingContext) {
                return;
              }
              const next = await refreshInstructions(
                files,
                directory,
                cwd,
                root,
                current,
                signal,
                options,
                missingContext,
              );
              signal.throwIfAborted();
              const changes = diffInstructions(visible, next);
              if (changes) {
                append(changes);
              }
              current = { ...next, instance };
              setState(current);
            }

            useAgentStart(
              async (context) => {
                if (delivery.kind === 'signal' && delivery.type === unavailableRoot) {
                  throw new WorkspaceInstructionsRootError(undefined);
                }
                if (delivery.kind === 'user') {
                  await reconcile(context);
                }
              },
              { restoreContext: (context) => reconcile(context, true) },
            );

            return {
              onFiles(paths, toolCallId, signal) {
                if (!cwd) {
                  return Promise.resolve();
                }
                return queueUpdate(sessionId, async () => {
                  signal?.throwIfAborted();
                  const next = await discoverTouchedInstructions(
                    files,
                    directory,
                    cwd,
                    paths,
                    current,
                    signal,
                    options,
                  ).catch(async (error: unknown) => {
                    if (!(error instanceof WorkspaceInstructionsRootError)) {
                      throw error;
                    }
                    // Tool failures become model-visible results. A joined start hook stops
                    // this response before the next provider call instead.
                    await dispatch({ kind: 'signal', type: unavailableRoot, body: error.message });
                  });
                  if (!next) {
                    return;
                  }
                  signal?.throwIfAborted();
                  const changes = diffInstructions(instructionVersions(current), next);
                  current = next;
                  setState(current);
                  if (changes) {
                    await dispatch({
                      ...changes,
                      attributes: { ...changes.attributes, toolCallId },
                    });
                  }
                });
              },
            };
          },
        });
      },
    },
  };
}
