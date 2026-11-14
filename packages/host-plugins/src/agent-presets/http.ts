import type { Hono } from 'hono';
import {
  type AgentPresets,
  agentPresetIdSchema,
  agentPresetInputSchema,
  defaultAgentPresetSchema,
  productRoutes,
  reviseAgentPresetSchema,
} from '@workspace/protocol/host';
import { bodyLimit } from 'hono/body-limit';
import type { createAgentPresetCatalog } from './catalog.js';

export function validPresetCapabilities(ids: string[], capabilities: AgentPresets['capabilities']) {
  return (
    new Set(ids).size === ids.length &&
    ids.every((id) => capabilities.some((item) => item.id === id))
  );
}

export function mountAgentPresets(
  app: Hono,
  catalog: ReturnType<typeof createAgentPresetCatalog>,
  capabilities: AgentPresets['capabilities'],
) {
  app.on(productRoutes.listPresets.method, productRoutes.listPresets.path, (c) =>
    c.json({ presets: catalog.list(), capabilities, defaultPresetId: catalog.defaultId() }),
  );

  app.on(
    productRoutes.createPreset.method,
    productRoutes.createPreset.path,
    bodyLimit({ maxSize: 64 * 1024 }),
    async (c) => {
      const input = agentPresetInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!input.success) {
        return c.json({ error: input.error.issues[0]?.message ?? 'Invalid preset.' }, 400);
      }

      const definition = input.data;
      if (!validPresetCapabilities(definition.capabilities, capabilities)) {
        return c.json({ error: 'Select available capabilities only, once each.' }, 400);
      }
      return c.json(catalog.create(definition), 201);
    },
  );

  app.on(
    productRoutes.setDefaultPreset.method,
    productRoutes.setDefaultPreset.path,
    bodyLimit({ maxSize: 2048 }),
    async (c) => {
      const input = defaultAgentPresetSchema.safeParse(await c.req.json().catch(() => null));
      if (!input.success) {
        return c.json({ error: 'Invalid default agent preset.' }, 400);
      }
      if (!catalog.saveDefault(input.data.presetId)) {
        return c.json({ error: 'Agent preset not found.' }, 404);
      }
      return c.json(input.data);
    },
  );

  app.on(
    productRoutes.revisePreset.method,
    productRoutes.revisePreset.path,
    bodyLimit({ maxSize: 64 * 1024 }),
    async (c) => {
      const id = agentPresetIdSchema.safeParse(c.req.param('id'));
      if (!id.success) {
        return c.json({ error: 'Invalid preset ID.' }, 400);
      }

      const input = reviseAgentPresetSchema.safeParse(await c.req.json().catch(() => null));
      if (!input.success) {
        return c.json({ error: input.error.issues[0]?.message ?? 'Invalid preset.' }, 400);
      }

      if (!catalog.get(id.data)) {
        return c.json({ error: 'Agent preset not found.' }, 404);
      }

      const { version, ...definition } = input.data;
      if (!validPresetCapabilities(definition.capabilities, capabilities)) {
        return c.json({ error: 'Select available capabilities only, once each.' }, 400);
      }

      const revised = catalog.revise(id.data, version, definition);
      if (!revised) {
        return c.json({ error: 'This preset has changed. Reopen it before saving.' }, 409);
      }
      return c.json(revised);
    },
  );
}
