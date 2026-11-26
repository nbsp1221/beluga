import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  defineTool,
  useAgentStart,
  useDelivery,
  useInstruction,
  usePersistentState,
  useTool,
} from '@flue/runtime';
import {
  agentSkillsCapabilityId,
  explicitSkillNames,
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
import { skillCatalog } from './prompt.js';

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
        context.provide('agentSkills', {
          metadata: {
            id: agentSkillsCapabilityId,
            name: 'Agent skills',
            description: 'Discover and load reusable instructions from SKILL.md files.',
          },
          async listSkills(cwd, signal) {
            const { sources, incomplete } = await discoverSkills(cwd, signal);
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
            const [{ catalog }, setState] = usePersistentState('agent-skills', {
              catalog: skillCatalog([], contextWindow),
            });

            async function refreshCatalog(signal: AbortSignal) {
              const discovery = await discoverSkills(cwd, signal);
              signal.throwIfAborted();
              setState({
                catalog: skillCatalog(discovery.sources, contextWindow, discovery.incomplete),
              });
              return discovery;
            }

            async function instructions(
              source: SkillSource,
              actor: 'model' | 'user',
              signal?: AbortSignal,
            ) {
              if (
                !sessions.sessionHasCapability(sessionId, agentSkillsCapabilityId) ||
                (source.scope === 'project' && sessions.workspaceRootForSession(sessionId) !== cwd)
              ) {
                throw new SkillLoadError('The conversation no longer allows this skill.');
              }
              const body = await loadSkill(source, actor, signal);
              return `Skill directory: ${source.directory}\nResolve relative references from this directory.\n\n${body}`;
            }

            useAgentStart(
              async ({ append, signal }) => {
                if (delivery.kind !== 'user') {
                  return;
                }
                const { sources, incomplete } = await refreshCatalog(signal);
                const byName = new Map(sources.map((source) => [source.name, source]));
                for (const name of explicitSkillNames(delivery.body)) {
                  const source =
                    byName.get(name) ??
                    (incomplete
                      ? (await discoverSkills(cwd, signal, name)).sources.at(0)
                      : undefined);
                  if (!source?.userInvocable) {
                    continue;
                  }
                  const body = await instructions(source, 'user', signal);
                  signal.throwIfAborted();
                  append({
                    kind: 'signal',
                    type: skillInvocationSignal,
                    tagName: 'system-reminder',
                    body,
                    attributes: {
                      id: randomUUID(),
                      name: source.name,
                      scope: source.scope,
                      contextLifetime: 'response',
                    },
                  });
                }
              },
              {
                async restoreContext({ signal }) {
                  await refreshCatalog(signal);
                },
              },
            );

            const catalogs = catalog.text ? [catalog.text] : [];
            catalogs.forEach(useInstruction);
            useTool(
              defineTool({
                name: 'skill',
                description: 'Load the full instructions for one available skill.',
                input: v.object({ name: v.string() }),
                async run({ data, signal }) {
                  const source = (await discoverSkills(cwd, signal, data.name)).sources.at(0);
                  if (!source?.modelInvocable) {
                    throw new SkillLoadError(
                      `Skill ${data.name} is not available for model invocation.`,
                    );
                  }
                  return instructions(source, 'model', signal);
                },
              }),
            );
            return {};
          },
        });
      },
    },
  };
}
