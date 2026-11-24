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
  refreshInstructions,
  resolveInstructionRoot,
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
        context.provide('agentInstructions', {
          metadata: {
            id,
            name: 'Workspace instructions',
            description: 'Load AGENTS.md guidance relevant to the conversation’s workspace.',
          },
          useContext(cwd) {
            const delivery = useDelivery();
            const dispatch = useDispatchMessage();
            const [state, setState] = usePersistentState<InstructionState>(
              'workspace-context',
              initialInstructions,
            );

            async function reconcile(
              { append, hasContextSignal, signal }: AgentStartContext,
              restoring = false,
            ) {
              if (!cwd) {
                return;
              }
              const currentIds = state.signalIds ?? [];
              const missingContext = currentIds.some((signalId) => !hasContextSignal(id, signalId));
              if (restoring && !missingContext) {
                return;
              }
              const root = await resolveInstructionRoot(files, cwd, signal, options);
              if (state.instance === instance && state.root === root && !missingContext) {
                return;
              }
              const next = await refreshInstructions(
                files,
                directory,
                cwd,
                root,
                state,
                signal,
                options,
                missingContext,
              );
              const changes = diffInstructions(state, next, missingContext);
              if (changes) {
                append(changes);
              }
              const signalIds = missingContext ? [] : currentIds;
              setState({
                ...next,
                instance,
                signalIds: changes ? [...signalIds, changes.attributes.id] : signalIds,
              });
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
              async onFiles(paths, toolCallId, signal) {
                if (!cwd) {
                  return;
                }
                const update = await discoverTouchedInstructions(
                  files,
                  directory,
                  cwd,
                  paths,
                  state,
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
                if (!update) {
                  return;
                }
                signal?.throwIfAborted();
                let changes: ReturnType<typeof diffInstructions>;
                setState((previous) => {
                  const next = update(previous);
                  changes = diffInstructions(previous, next);
                  return changes
                    ? { ...next, signalIds: [...(previous.signalIds ?? []), changes.attributes.id] }
                    : next;
                });
                if (changes) {
                  await dispatch({ ...changes, attributes: { ...changes.attributes, toolCallId } });
                }
              },
            };
          },
        });
      },
    },
  };
}
