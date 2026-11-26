import { randomUUID } from 'node:crypto';
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
  selectedSkillUnavailable,
  skillInvocationSignal,
} from '@workspace/protocol/host';
import * as v from 'valibot';
import type { AgentCapability, AgentCapabilityPlugin } from '../agent-capabilities/host.js';
import {
  SkillLoadError,
  type SkillSource,
  createSkillDiscovery,
  loadSkill,
  selectionId,
} from './discovery.js';
import { skillBodyTokens, skillCatalog, skillRestoreLimit } from './prompt.js';

interface Activation {
  id: string;
  name: string;
  scope: SkillSource['scope'];
  sourceId: string;
  actor: 'model' | 'user';
  toolCallId?: string;
  tokens: number;
  body: string;
}

type SkillUse = Pick<Activation, 'id' | 'name' | 'sourceId' | 'actor'> & {
  tool?: { assistantMessageId: string; toolCallId: string };
  deferred?: true;
  eligible?: boolean;
};

interface PendingSkillUses {
  responseId: string;
  uses: readonly SkillUse[];
}

interface SkillState {
  catalog: ReturnType<typeof skillCatalog>;
  active: readonly Activation[];
}

function activationSignal(
  activation: Activation,
  options: { restored?: boolean; origin?: { assistantMessageId: string; responseId: string } } = {},
): AgentAppendMessage {
  const { id, name, scope, sourceId, actor, toolCallId, body } = activation;
  return {
    kind: 'signal',
    type: skillInvocationSignal,
    tagName: 'system-reminder',
    body,
    attributes: {
      id,
      name,
      scope,
      sourceId,
      actor,
      contextLifetime: 'response',
      ...(toolCallId && { toolCallId }),
      ...(options.origin && {
        assistantMessageId: options.origin.assistantMessageId,
        originResponseId: options.origin.responseId,
      }),
      ...(options.restored && { restored: 'true' }),
    },
  };
}

function canRestore(activation: SkillUse, sources: readonly SkillSource[]) {
  return sources.some(
    (source) =>
      source.name === activation.name &&
      selectionId(source) === activation.sourceId &&
      (activation.actor === 'model' ? source.modelInvocable : source.userInvocable),
  );
}

function skillUse({ id, name, sourceId, actor }: Activation, tool?: SkillUse['tool']): SkillUse {
  return { id, name, sourceId, actor, tool };
}

function recordUse(current: PendingSkillUses | null, responseId: string, use: SkillUse) {
  const uses = current?.responseId === responseId ? current.uses : [];
  return { responseId, uses: [...uses, use] };
}

function visibleActivation(
  activation: Activation,
  signals: ReturnType<AgentStartContext['contextSignals']>,
) {
  const previous = signals.findLast(({ attributes }) => attributes?.name === activation.name);
  if (
    previous?.attributes?.id &&
    previous.attributes.sourceId === activation.sourceId &&
    previous.content === activation.body
  ) {
    return {
      ...activation,
      id: previous.attributes.id,
      toolCallId: previous.attributes.toolCallId,
    };
  }
}

function withinRestoreBudget(active: readonly Activation[], limit: number) {
  let used = 0;
  return active.filter(({ tokens }) => {
    if (used + tokens > limit) {
      return false;
    }
    used += tokens;
    return true;
  });
}

function readActivation({
  content,
  attributes,
}: ReturnType<AgentStartContext['contextSignals']>[number]): Activation | undefined {
  if (!attributes) {
    return;
  }
  const { id, name, scope, sourceId, actor, toolCallId } = attributes;
  if (
    id &&
    name &&
    sourceId &&
    (scope === 'project' || scope === 'global') &&
    (actor === 'user' || actor === 'model')
  ) {
    return {
      id,
      name,
      scope,
      sourceId,
      actor,
      toolCallId,
      body: content,
      tokens: skillBodyTokens(content, name),
    } satisfies Activation;
  }
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
  const discoverSkills = createSkillDiscovery(roots);
  return {
    service: 'agentSkills',
    plugin: {
      id: agentSkillsCapabilityId,
      requires: ['workspaceToolSessions'],
      provides: ['agentSkills'],
      setup(context) {
        const sessions = context.get('workspaceToolSessions');
        const pendingBySession = new Map<string, Map<string, Promise<string>>>();
        context.provide('agentSkills', {
          metadata: {
            id: agentSkillsCapabilityId,
            name: 'Agent skills',
            description: 'Discover and load reusable instructions from SKILL.md files.',
          },
          async listSkills(cwd, signal, onlyName) {
            const { sources, incomplete } = await discoverSkills(cwd, signal, onlyName);
            return {
              incomplete,
              items: sources
                .filter(({ userInvocable }) => userInvocable)
                .map((source) => ({
                  id: selectionId(source),
                  name: source.name,
                  description: source.description,
                  userOnly: !source.modelInvocable,
                })),
            };
          },
          useContext(cwd, sessionId, contextWindow) {
            const delivery = useDelivery();
            const dispatch = useDispatchMessage();
            const [state, setState] = usePersistentState<SkillState>('agent-skills', {
              catalog: { text: '', entries: [] },
              active: [],
            });
            const [pending, setPending] = usePersistentState<PendingSkillUses | null>(
              'agent-skills-pending',
              null,
            );
            const { catalog } = state;
            const restoreLimit = skillRestoreLimit(contextWindow);

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
                throw new SkillLoadError('The conversation no longer allows this skill.');
              }
              const instructions = await loadSkill(source, actor, signal);
              const body = `Skill directory: ${source.directory}\nResolve relative references from this directory.\n\n${instructions}`;
              const tokens = skillBodyTokens(body, source.name);
              return {
                id: randomUUID(),
                name: source.name,
                scope: source.scope,
                sourceId: selectionId(source),
                actor,
                toolCallId,
                tokens,
                body,
              } satisfies Activation;
            }

            function restore(
              { append, contextSignals }: AgentStartContext,
              active: readonly Activation[],
            ) {
              const visible = new Set(
                contextSignals(skillInvocationSignal).map(({ attributes }) => attributes?.id),
              );
              for (const activation of withinRestoreBudget(active, restoreLimit)) {
                if (!visible.has(activation.id)) {
                  append(activationSignal(activation, { restored: true }));
                }
              }
            }

            useAgentStart(
              async (start) => {
                if (delivery.kind === 'signal') {
                  const {
                    id,
                    name,
                    sourceId,
                    actor,
                    assistantMessageId,
                    toolCallId,
                    originResponseId,
                  } = delivery.attributes ?? {};
                  if (
                    delivery.type !== skillInvocationSignal ||
                    actor !== 'model' ||
                    !id ||
                    !name ||
                    !sourceId ||
                    !assistantMessageId ||
                    !toolCallId ||
                    !originResponseId
                  ) {
                    return;
                  }
                  const uses = pending?.responseId === start.responseId ? pending.uses : [];
                  const position = uses.findIndex(
                    (use) =>
                      use.id === id &&
                      use.tool?.assistantMessageId === assistantMessageId &&
                      use.tool.toolCallId === toolCallId,
                  );
                  if (position >= 0 && uses[position]?.eligible !== false) {
                    return;
                  }
                  const use: SkillUse = {
                    id,
                    name,
                    sourceId,
                    actor,
                    tool: { assistantMessageId, toolCallId },
                    deferred: originResponseId !== start.responseId ? true : undefined,
                  };
                  const { sources } = await discoverSkills(cwd, start.signal, name);
                  start.signal.throwIfAborted();
                  if (canRestore(use, sources)) {
                    setPending({
                      responseId: start.responseId,
                      uses: position < 0 ? [...uses, use] : uses.toSpliced(position, 1, use),
                    });
                  }
                  return;
                }
                const { sources } = await discoverSkills(cwd, start.signal);
                const selected = explicitSkillName(delivery.body);
                const source = selected
                  ? (await discoverSkills(cwd, start.signal, selected)).sources.find(
                      ({ userInvocable }) => userInvocable,
                    )
                  : undefined;
                const selectedId = delivery.attributes?.selectedSkillId;
                if (selectedId && (!source || selectionId(source) !== selectedId)) {
                  throw new SkillLoadError(selectedSkillUnavailable.message);
                }
                const next = source && (await activate(source, 'user', start.signal));
                start.signal.throwIfAborted();
                const previous =
                  next && visibleActivation(next, start.contextSignals(skillInvocationSignal));
                const uses = pending?.responseId === start.responseId ? pending.uses : [];
                const names = new Set([...state.active, ...uses].map(({ name }) => name));
                const candidates = new Map(
                  await Promise.all(
                    [...names].map(async (name) => {
                      const matching = sources.find((source) => source.name === name);
                      return [
                        name,
                        matching
                          ? [matching]
                          : (await discoverSkills(cwd, start.signal, name)).sources,
                      ] as const;
                    }),
                  ),
                );

                const eligible = (use: SkillUse) => canRestore(use, candidates.get(use.name) ?? []);

                const active = state.active.filter(eligible);
                // Keep call order while a source is shadowed. Its queued signal can
                // revalidate the source before this response reaches the model.
                const pendingUses = uses.map((use) => ({ ...use, eligible: eligible(use) }));
                const used = previous ?? next;
                if (used) {
                  pendingUses.push({ ...skillUse(used), eligible: true });
                }
                if (pending || pendingUses.length) {
                  setPending(
                    pendingUses.length ? { responseId: start.responseId, uses: pendingUses } : null,
                  );
                }
                setState({
                  catalog: skillCatalog(sources, contextWindow),
                  active,
                });
                restore(start, active);
                if (next && !previous) {
                  start.append(activationSignal(next));
                }
              },
              {
                restoreContext: (start) => restore(start, state.active),
                onModelInput(contextSignals, response) {
                  if (pending?.responseId !== response.id) {
                    return;
                  }
                  const visible = contextSignals(skillInvocationSignal);
                  // Flue applies queued signals in admission order. A deferred tool use
                  // happened before the receiving response's own selections.
                  const uses = [
                    ...pending.uses.filter((use) => use.deferred),
                    ...pending.uses.filter((use) => !use.deferred),
                  ];
                  setState((current) => {
                    let active = current.active;
                    for (const use of uses) {
                      if (
                        use.eligible === false ||
                        (use.tool &&
                          !response.toolCallSucceeded(
                            use.tool.assistantMessageId,
                            use.tool.toolCallId,
                          ))
                      ) {
                        continue;
                      }
                      const signal = visible.find(({ attributes }) => attributes?.id === use.id);
                      const activation = signal && readActivation(signal);
                      if (activation) {
                        active = [
                          { ...activation, actor: use.actor },
                          ...active.filter(({ name }) => name !== activation.name),
                        ];
                      }
                    }
                    return active === current.active
                      ? current
                      : { ...current, active: withinRestoreBudget(active, restoreLimit) };
                  });
                  setPending(null);
                },
              },
            );

            const instructions = catalog.text ? [catalog.text] : [];
            instructions.forEach(useInstruction);
            const tools = catalog.text
              ? [
                  defineTool({
                    name: 'skill',
                    description: 'Load the full instructions for one listed skill.',
                    input: v.object({ name: v.string() }),
                    async run({ data, signal, toolCallId, toolInvocation, contextSignals }) {
                      const source = catalog.entries.find(({ name }) => name === data.name);
                      if (!source) {
                        throw new Error('Choose a skill from the available skills list.');
                      }
                      if (!toolInvocation) {
                        throw new Error('A skill call requires an active conversation response.');
                      }
                      const { responseId, assistantMessageId } = toolInvocation;
                      const loads =
                        pendingBySession.get(sessionId) ?? new Map<string, Promise<string>>();
                      pendingBySession.set(sessionId, loads);
                      const existing = loads.get(source.name);
                      if (existing) {
                        return existing;
                      }
                      const job = (async () => {
                        const next = await activate(source, 'model', signal, toolCallId);
                        signal?.throwIfAborted();
                        const previous = visibleActivation(
                          next,
                          contextSignals?.(skillInvocationSignal) ?? [],
                        );
                        if (!previous) {
                          await dispatch(
                            activationSignal(next, { origin: { assistantMessageId, responseId } }),
                          );
                          signal?.throwIfAborted();
                        }
                        const used = previous ?? next;
                        setPending((current) =>
                          recordUse(
                            current,
                            responseId,
                            skillUse(used, { assistantMessageId, toolCallId }),
                          ),
                        );
                        return `Loaded skill: ${next.name}.`;
                      })();
                      loads.set(source.name, job);
                      try {
                        return await job;
                      } finally {
                        loads.delete(source.name);
                        if (!loads.size) {
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
