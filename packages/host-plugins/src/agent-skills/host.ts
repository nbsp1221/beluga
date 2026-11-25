import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentAppendMessage,
  type AgentStartContext,
  defineTool,
  useAgentStart,
  useDelivery,
  useDispatchMessage,
  useInstruction,
  usePersistentState,
  useTool,
} from '@flue/runtime';
import {
  agentSkillsCapabilityId,
  explicitSkillName,
  skillInvocationSignal,
} from '@workspace/protocol/host';
import * as v from 'valibot';
import type { AgentCapability, AgentCapabilityPlugin } from '../agent-capabilities/host.js';
import { type SkillSource, discoverSkills, loadSkill } from './discovery.js';
import { skillBodyLimit, skillBodyTokens, skillCatalog } from './prompt.js';

interface Activation {
  id: string;
  name: string;
  scope: SkillSource['scope'];
  path: string;
  actor: 'model' | 'user';
  toolCallId?: string;
  digest: string;
  tokens: number;
  body: string;
}

interface SkillState {
  catalog: ReturnType<typeof skillCatalog>;
  active: readonly Activation[];
}

function activationSignal(activation: Activation, restored = false): AgentAppendMessage {
  const { id, name, scope, toolCallId, body } = activation;
  return {
    kind: 'signal',
    type: skillInvocationSignal,
    tagName: 'system-reminder',
    body,
    attributes: {
      id,
      name,
      scope,
      ...(toolCallId && { toolCallId }),
      ...(restored && { restored: 'true' }),
    },
  };
}

function canRestore(activation: Activation, sources: readonly SkillSource[]) {
  return sources.some(
    (source) =>
      source.name === activation.name &&
      source.path === activation.path &&
      (activation.actor === 'model' ? source.modelInvocable : source.userInvocable),
  );
}

declare module '@workspace/runtime' {
  interface Services {
    agentSkills: AgentCapability;
  }
}

export function agentSkillsCapability(
  dataDirectory: string,
  home = homedir(),
): AgentCapabilityPlugin {
  const roots = [join(dataDirectory, 'skills'), join(home, '.agents', 'skills')];
  return {
    service: 'agentSkills',
    plugin: {
      id: agentSkillsCapabilityId,
      requires: ['workspaceToolSessions', 'trajectory'],
      provides: ['agentSkills'],
      setup(context) {
        const sessions = context.get('workspaceToolSessions');
        const trajectory = context.get('trajectory');
        const pendingBySession = new Map<string, Map<string, Promise<string>>>();
        context.provide('agentSkills', {
          metadata: {
            id: agentSkillsCapabilityId,
            name: 'Agent skills',
            description: 'Discover and load reusable instructions from SKILL.md files.',
          },
          async listSkills(cwd, signal) {
            return (await discoverSkills(cwd, roots, signal))
              .filter(({ userInvocable }) => userInvocable)
              .map(({ name, description, modelInvocable }) => ({
                name,
                description,
                userOnly: !modelInvocable,
              }));
          },
          useContext(cwd, sessionId, contextWindow) {
            const delivery = useDelivery();
            const dispatch = useDispatchMessage();
            const [state, setState] = usePersistentState<SkillState>('agent-skills', {
              catalog: { text: '', entries: [] },
              active: [],
            });
            const { catalog } = state;
            const bodyLimit = skillBodyLimit(contextWindow);
            const restoreLimit = skillBodyLimit(contextWindow, true);

            async function activate(
              source: SkillSource,
              actor: Activation['actor'],
              signal?: AbortSignal,
              toolCallId?: string,
            ) {
              if (
                !sessions.sessionHasCapability(sessionId, agentSkillsCapabilityId) ||
                (source.scope === 'project' && sessions.workspaceRootForSession(sessionId) !== cwd)
              ) {
                throw new Error('The conversation no longer allows this skill.');
              }
              const instructions = await loadSkill(source, actor, signal);
              const body = `Skill directory: ${source.directory}\nResolve relative references from this directory.\n\n${instructions}`;
              const tokens = skillBodyTokens(body, source.name);
              if (tokens > bodyLimit) {
                throw new Error(
                  `Skill ${source.name} exceeds the ${bodyLimit}-token instruction limit.`,
                );
              }
              const digest = createHash('sha256').update(body).digest('hex');
              return {
                id: randomUUID(),
                name: source.name,
                scope: source.scope,
                path: source.path,
                actor,
                toolCallId,
                digest,
                tokens,
                body,
              } satisfies Activation;
            }

            function save(activation: Activation) {
              setState((current) => {
                let used = 0;
                const active = [
                  activation,
                  ...current.active.filter(({ name }) => name !== activation.name),
                ].filter(({ tokens }) => {
                  if (used + tokens > restoreLimit) {
                    return false;
                  }
                  used += tokens;
                  return true;
                });
                return { ...current, active };
              });
            }

            function restore(
              { append, contextSignals }: AgentStartContext,
              sources?: readonly SkillSource[],
            ) {
              const visible = new Set(
                contextSignals(skillInvocationSignal).map(({ attributes }) => attributes?.id),
              );
              let left = restoreLimit;
              for (const activation of state.active) {
                if ((sources && !canRestore(activation, sources)) || activation.tokens > left) {
                  continue;
                }
                if (visible.has(activation.id)) {
                  left -= activation.tokens;
                } else if (trajectory.hasAppliedContext(sessionId, activation.id)) {
                  left -= activation.tokens;
                  append(activationSignal(activation, true));
                }
              }
            }

            useAgentStart(
              async (start) => {
                if (delivery.kind !== 'user') {
                  return;
                }
                const sources = await discoverSkills(cwd, roots, start.signal);
                const visible = new Set(
                  start
                    .contextSignals(skillInvocationSignal)
                    .map(({ attributes }) => attributes?.id),
                );
                const selected = explicitSkillName(delivery.body);
                const source = sources.find(
                  ({ name, userInvocable }) => userInvocable && name === selected,
                );
                const next = source && (await activate(source, 'user', start.signal));
                start.signal.throwIfAborted();
                setState((current) => ({
                  ...current,
                  catalog: skillCatalog(sources, contextWindow),
                  active: current.active.filter((item) => canRestore(item, sources)),
                }));
                restore(start, next ? sources.filter(({ name }) => name !== next.name) : sources);
                if (next) {
                  const previous = state.active.find(
                    ({ name, digest }) => name === next.name && digest === next.digest,
                  );
                  if (!previous || !visible.has(previous.id)) {
                    start.append(activationSignal(next));
                    save(next);
                  }
                }
              },
              { restoreContext: (start) => restore(start) },
            );

            const instructions = catalog.text ? [catalog.text] : [];
            instructions.forEach(useInstruction);
            const tools = catalog.text
              ? [
                  defineTool({
                    name: 'skill',
                    description: 'Load the full instructions for one listed skill.',
                    input: v.object({ name: v.string() }),
                    async run({ data, signal, toolCallId }) {
                      const source = catalog.entries.find(({ name }) => name === data.name);
                      if (!source) {
                        throw new Error('Choose a skill from the available skills list.');
                      }
                      const pending =
                        pendingBySession.get(sessionId) ?? new Map<string, Promise<string>>();
                      pendingBySession.set(sessionId, pending);
                      const existing = pending.get(source.name);
                      if (existing) {
                        return existing;
                      }
                      const job = (async () => {
                        const next = await activate(source, 'model', signal, toolCallId);
                        signal?.throwIfAborted();
                        if (
                          !state.active.some(
                            ({ name, digest }) => name === next.name && digest === next.digest,
                          )
                        ) {
                          await dispatch(activationSignal(next));
                          signal?.throwIfAborted();
                          save(next);
                        }
                        return `Loaded skill: ${next.name}.`;
                      })();
                      pending.set(source.name, job);
                      try {
                        return await job;
                      } finally {
                        pending.delete(source.name);
                        if (!pending.size) {
                          pendingBySession.delete(sessionId);
                        }
                      }
                    },
                  }),
                ]
              : [];
            tools.forEach(useTool);
            return {};
          },
        });
      },
    },
  };
}
