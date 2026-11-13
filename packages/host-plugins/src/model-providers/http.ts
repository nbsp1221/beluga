import type { Hono } from 'hono';
import {
  PROVIDERS_PATH,
  connectProviderSchema,
  defaultModelSchema,
} from '@workspace/protocol/host';
import { bodyLimit } from 'hono/body-limit';
import { type ModelProviders, ProviderConnectionError } from './contract.js';

interface ModelPreferences {
  defaultModel(): string | null;
  saveDefaultModel(model: string | null): void;
}

export function mountProviders(
  app: Hono,
  providers: ModelProviders,
  preferences: ModelPreferences,
) {
  const settings = async () => ({
    providers: await providers.list(),
    defaultModel: preferences.defaultModel(),
  });

  app.get(PROVIDERS_PATH, async (c) => c.json(await settings()));

  app.post(PROVIDERS_PATH, bodyLimit({ maxSize: 64 * 1024 }), async (c) => {
    const input = connectProviderSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) {
      return c.json({ error: 'Check the connection details.' }, 400);
    }

    try {
      await providers.connect(input.data);
    } catch (error) {
      if (error instanceof ProviderConnectionError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
    return c.json(await settings(), 201);
  });

  app.put(`${PROVIDERS_PATH}/openai-codex`, async (c) => {
    await providers.setCodexConnected(true);
    return c.json(await settings());
  });

  app.delete(`${PROVIDERS_PATH}/:id`, async (c) => {
    const id = c.req.param('id');
    if (id === 'openai-codex') {
      await providers.setCodexConnected(false);
    } else if (!(await providers.disconnect(id))) {
      return c.json({ error: 'Provider connection not found.' }, 404);
    }
    return c.json(await settings());
  });

  app.put(`${PROVIDERS_PATH}/default-model`, bodyLimit({ maxSize: 2048 }), async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    const model = body && typeof body === 'object' && 'model' in body ? body.model : undefined;
    const input = defaultModelSchema.safeParse(model);
    if (!input.success) {
      return c.json({ error: 'Invalid default model.' }, 400);
    }

    if (
      input.data !== null &&
      !(await providers.list()).some((provider) =>
        provider.models.some(({ id }) => id === input.data),
      )
    ) {
      return c.json({ error: 'Choose a model from a connected provider.' }, 400);
    }

    preferences.saveDefaultModel(input.data);
    return c.json(await settings());
  });
}
