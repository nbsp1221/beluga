import type { Hono } from 'hono';
import { connectProviderSchema, defaultModelSchema, productRoutes } from '@workspace/protocol/host';
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

  app.on(productRoutes.listProviders.method, productRoutes.listProviders.path, async (c) =>
    c.json(await settings()),
  );

  app.on(
    productRoutes.connectProvider.method,
    productRoutes.connectProvider.path,
    bodyLimit({ maxSize: 64 * 1024 }),
    async (c) => {
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
    },
  );

  app.on(productRoutes.connectCodex.method, productRoutes.connectCodex.path, async (c) => {
    await providers.setCodexConnected(true);
    return c.json(await settings());
  });

  app.on(
    productRoutes.disconnectProvider.method,
    productRoutes.disconnectProvider.path,
    async (c) => {
      const id = c.req.param('id');
      if (id === 'openai-codex') {
        await providers.setCodexConnected(false);
      } else if (!(await providers.disconnect(id))) {
        return c.json({ error: 'Provider connection not found.' }, 404);
      }
      return c.json(await settings());
    },
  );

  app.on(
    productRoutes.setDefaultModel.method,
    productRoutes.setDefaultModel.path,
    bodyLimit({ maxSize: 2048 }),
    async (c) => {
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
    },
  );
}
