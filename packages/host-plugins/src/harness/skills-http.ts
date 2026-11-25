import type { Hono } from 'hono';
import { agentSkillsCapabilityId, productRoutes } from '@workspace/protocol/host';
import type { AgentContextCapability } from '../agent-capabilities/host.js';
import type { WorkspaceCatalog } from '../workspace/services.js';

export function mountSkillSuggestions(
  app: Hono,
  catalog: WorkspaceCatalog,
  listSkills: NonNullable<AgentContextCapability['listSkills']>,
) {
  app.on(productRoutes.listSkills.method, productRoutes.listSkills.path, async (c) => {
    const { sessionId, presetId, presetVersion } = c.req.query();
    const session = sessionId ? catalog.findSession(sessionId) : undefined;
    const workspaceId = c.req.query('workspaceId') ?? '';
    const workspace = catalog.find(session?.workspaceId ?? workspaceId);
    const preset = session
      ? catalog.sessionPreset(session.id)
      : presetId &&
        catalog.presets.get(presetId, presetVersion ? Number(presetVersion) : undefined);
    if ((sessionId && !session) || !workspace || !preset) {
      return c.json([]);
    }
    if (!preset.capabilities.includes(agentSkillsCapabilityId)) {
      return c.json([]);
    }
    return c.json(await listSkills(workspace.path, c.req.raw.signal));
  });
}
