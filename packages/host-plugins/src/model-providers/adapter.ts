import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ConnectProvider, ProviderConnection } from '@workspace/protocol/host';
import {
  type Api,
  type Model,
  createModels,
  createProvider,
  getSupportedThinkingLevels,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { type OpenModelProviders, ProviderConnectionError } from './contract.js';

const codexId = 'openai-codex';
const codexName = 'ChatGPT / Codex';
const keyless = 'beluga-keyless';

function codexProvider(connected: () => boolean) {
  const provider = openaiCodexProvider();
  const home = process.env.CODEX_HOME;
  const path = join(home && isAbsolute(home) ? home : join(homedir(), '.codex'), 'auth.json');

  return {
    ...provider,
    streamSimple: (...[model, context, options]: Parameters<typeof provider.streamSimple>) =>
      provider.streamSimple(model, context, { ...options, transport: 'sse' }),
    auth: {
      apiKey: {
        name: 'Codex access token',
        async resolve() {
          if (!connected()) {
            return;
          }

          const file = await readFile(path, 'utf8').catch(() => undefined);
          if (!file || !connected()) {
            return;
          }

          try {
            const credential: unknown = JSON.parse(file);
            const tokens =
              credential && typeof credential === 'object' && 'tokens' in credential
                ? credential.tokens
                : undefined;
            const apiKey =
              tokens && typeof tokens === 'object' && 'access_token' in tokens
                ? tokens.access_token
                : undefined;
            if (typeof apiKey === 'string' && apiKey) {
              return { auth: { apiKey } };
            }
          } catch {
            // Codex owns this file and can rewrite it while refreshing its login.
          }
        },
      },
    },
  };
}

const modelOption = (model: Model<Api>, providerName: string) => ({
  id: `${model.provider}/${model.id}`,
  name: model.name,
  providerName,
  efforts: model.reasoning ? getSupportedThinkingLevels(model) : [],
});

type CompatibleConnection = Pick<ConnectProvider, 'name' | 'baseUrl' | 'models'> & {
  hasKey: boolean;
};

function parseConnection(json: string): CompatibleConnection {
  const config: unknown = JSON.parse(json);

  if (
    !config ||
    typeof config !== 'object' ||
    !('name' in config) ||
    typeof config.name !== 'string' ||
    !('baseUrl' in config) ||
    typeof config.baseUrl !== 'string' ||
    !('models' in config) ||
    !Array.isArray(config.models) ||
    !config.models.every((model): model is string => typeof model === 'string') ||
    !('hasKey' in config) ||
    typeof config.hasKey !== 'boolean'
  ) {
    throw new Error('Invalid saved provider connection.');
  }

  return {
    name: config.name,
    baseUrl: config.baseUrl,
    models: config.models,
    hasKey: config.hasKey,
  };
}

async function discoverModels(baseUrl: string, apiKey: string) {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return [];
    }

    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data)) {
      return [];
    }

    const modelIds = body.data.flatMap((entry: unknown) => {
      const id = entry && typeof entry === 'object' && 'id' in entry ? entry.id : undefined;
      return typeof id === 'string' && id.trim() && id.length <= 200 ? [id.trim()] : [];
    });
    return [...new Set(modelIds)].slice(0, 256);
  } catch {
    return [];
  }
}

function customProvider(
  id: string,
  connection: CompatibleConnection,
  readKey: () => Promise<string | undefined>,
) {
  const streams = openAICompletionsApi();

  const endpointFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (!connection.hasKey) {
      headers.delete('authorization');
    }
    return fetch(input, { ...init, headers, redirect: 'error' });
  };

  return createProvider({
    id,
    name: connection.name,
    baseUrl: connection.baseUrl,
    auth: {
      apiKey: {
        name: 'API key',
        async resolve() {
          const apiKey = await readKey();
          if (apiKey) {
            return { auth: { apiKey } };
          }
        },
      },
    },
    api: {
      stream: (model, context, options) =>
        streams.stream(model, context, { ...options, fetch: endpointFetch }),
      streamSimple: (model, context, options) =>
        streams.streamSimple(model, context, {
          ...options,
          fetch: endpointFetch,
        }),
    },
    models: connection.models.map((model) => ({
      id: model,
      name: model,
      provider: id,
      api: 'openai-completions' as const,
      baseUrl: connection.baseUrl,
      input: ['text'],
      reasoning: false,
      contextWindow: 0,
      maxTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
    })),
  });
}

export function openModelProviders(databasePath: string, dataDir: string): OpenModelProviders {
  return (register) => {
    const db = new DatabaseSync(databasePath);
    const keyDir = join(dataDir, 'provider-credentials');

    const keyPath = (id: string) => join(keyDir, `${id}.key`);

    try {
      db.exec(
        'CREATE TABLE IF NOT EXISTS provider_connections (id TEXT PRIMARY KEY, config TEXT NOT NULL)',
      );

      const insert = db.prepare('INSERT OR REPLACE INTO provider_connections VALUES (?, ?)');
      const remove = db.prepare('DELETE FROM provider_connections WHERE id = ?');

      const rows = db.prepare('SELECT * FROM provider_connections').all();
      let codexEnabled = rows.find(({ id }) => id === codexId)?.config !== 'false';
      const connections = new Map(
        rows
          .filter(({ id }) => id !== codexId)
          .map(({ id, config }) => [String(id), parseConnection(String(config))]),
      );

      const registry = createModels();

      const registerProvider: Parameters<OpenModelProviders>[0] = (provider) => {
        registry.setProvider(provider);
        register(provider);
      };

      const add = (id: string, config: CompatibleConnection) => {
        registerProvider(
          customProvider(id, config, async () => {
            if (!connections.has(id)) {
              return;
            }
            const key = config.hasKey
              ? await readFile(keyPath(id), 'utf8').catch(() => undefined)
              : keyless;
            return connections.has(id) ? key : undefined;
          }),
        );
      };

      registerProvider(codexProvider(() => codexEnabled));
      for (const [id, config] of connections) {
        add(id, config);
      }

      return {
        contextWindow: (providerId, modelId) =>
          registry.getModel(providerId, modelId)?.contextWindow,
        async list() {
          const codexModels = await registry.getAvailable(codexId);
          const codexSummary: ProviderConnection = {
            id: codexId,
            name: codexName,
            kind: 'codex',
            status: !codexEnabled
              ? 'disconnected'
              : codexModels.length
                ? 'connected'
                : 'missing-login',
            models: codexEnabled ? codexModels.map((model) => modelOption(model, codexName)) : [],
          };

          const compatibleSummaries = await Promise.all(
            [...connections].map(async ([id, config]): Promise<ProviderConnection> => {
              const models = await registry.getAvailable(id);
              return {
                id,
                name: config.name,
                kind: 'openai-compatible',
                status: models.length ? 'connected' : 'disconnected',
                baseUrl: config.baseUrl,
                models: connections.has(id)
                  ? models.map((model) => modelOption(model, config.name))
                  : [],
              };
            }),
          );
          return [codexSummary, ...compatibleSummaries];
        },
        async connect({ name, baseUrl, apiKey, models }) {
          const url = new URL(baseUrl);
          if (
            (url.protocol !== 'http:' && url.protocol !== 'https:') ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          ) {
            throw new ProviderConnectionError(
              'Use an HTTP or HTTPS base URL without credentials, query parameters, or a fragment.',
            );
          }

          const normalizedUrl = url.href.replace(/\/+$/, '');
          const modelIds = models.length
            ? [...new Set(models)]
            : await discoverModels(normalizedUrl, apiKey);
          if (!modelIds.length) {
            throw new ProviderConnectionError(
              'Could not list models. Check the connection or enter a model ID.',
            );
          }

          const id = `compatible-${randomUUID()}`;
          const config = {
            name,
            baseUrl: normalizedUrl,
            models: modelIds,
            hasKey: Boolean(apiKey),
          };

          if (apiKey) {
            await mkdir(keyDir, { recursive: true, mode: 0o700 });
            await writeFile(keyPath(id), apiKey, { flag: 'wx', mode: 0o600 });
          }

          try {
            insert.run(id, JSON.stringify(config));
          } catch (error) {
            if (apiKey) {
              await rm(keyPath(id), { force: true });
            }
            throw error;
          }

          connections.set(id, config);
          add(id, config);
        },
        setCodexConnected(connected) {
          insert.run(codexId, JSON.stringify(connected));
          codexEnabled = connected;
        },
        async disconnect(id) {
          const connection = connections.get(id);
          if (!connection) {
            return false;
          }

          remove.run(id);
          connections.delete(id);
          registry.deleteProvider(id);
          if (connection.hasKey) {
            await rm(keyPath(id), { force: true }).catch(() => {
              console.error('Could not remove the disconnected provider credential.');
            });
          }
          return true;
        },
        close() {
          codexEnabled = false;
          connections.clear();
          db.close();
        },
      };
    } catch (error) {
      db.close();
      throw error;
    }
  };
}
