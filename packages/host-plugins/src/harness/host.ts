import type { Plugin } from '@workspace/runtime';
import { init, setProvider, useInitialData, useModel, useTool } from '@flue/runtime';
import { sqlite, start } from '@flue/runtime/node';
import { createAgentRouter } from '@flue/runtime/routing';
import {
  CONVERSATION_PATH,
  type RunSettings,
  accessModeInputSchema,
  agentPresetInputSchema,
  availableAccessModes,
  createSessionSchema,
  runSettingsSchema,
} from '@workspace/protocol/host';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import * as v from 'valibot';
import type { AgentCapability, CapabilityService } from '../agent-capabilities/host.js';
import type { HttpService } from '../http/contract.js';
import type { OpenModelProviders } from '../model-providers/contract.js';
import type { WorkspaceCatalog } from '../workspace/services.js';
import { mountAgentPresets, validPresetCapabilities } from '../agent-presets/http.js';
import '../trajectory/contract.js';
import '../auth/services.js';
import { mountProviders } from '../model-providers/http.js';
import { allowsTools } from '../workspace/tool-access.js';

const initialData = v.object({ sessionId: v.string() });

declare module '@workspace/runtime' {
  interface Services {
    conversationHttp: HttpService & { abortConversations(): Promise<void> };
  }
}

export interface HarnessOptions {
  origin: string;
  openProviders: OpenModelProviders;
  databasePath: string;
  initialAgentPreset?: unknown;
}

export function createHarnessHost(
  options: HarnessOptions,
  capabilityServices: readonly CapabilityService[] = [],
): Plugin {
  return {
    id: 'harness',
    requires: ['auth', 'workspaceCatalog', 'trajectory', ...capabilityServices],
    provides: ['conversationHttp'],
    async setup(context) {
      const auth = context.get('auth');
      const catalog = context.get('workspaceCatalog');

      const trajectory = context.get('trajectory');

      const capabilitiesById = indexCapabilities(
        capabilityServices.map((service) => context.get(service)),
      );
      const capabilityMetadata = [...capabilitiesById.values()].map(
        (capability) => capability.metadata,
      );
      if (options.initialAgentPreset !== undefined) {
        catalog.presets.initializeDefault(() => {
          const definition = agentPresetInputSchema.parse(options.initialAgentPreset);
          if (!validPresetCapabilities(definition.capabilities, capabilityMetadata)) {
            throw new Error(
              'The initial agent preset references invalid or unavailable capabilities.',
            );
          }
          return definition;
        });
      }

      const providers = options.openProviders(setProvider);
      context.onDispose(() => providers.close());
      trajectory.bindModelContext((providerId, modelId) =>
        providers.contextWindow(providerId, modelId),
      );

      const availableModels = async () =>
        (await providers.list()).flatMap((provider) => provider.models);

      const supportsRunSettings = async ({ model, effort }: RunSettings) => {
        const option = (await availableModels()).find(({ id }) => id === model);
        return option !== undefined && (effort === 'default' || option.efforts.includes(effort));
      };

      const BelugaPresetAgent = createPresetAgent(catalog, capabilitiesById);
      const runtime = await start({
        agents: [BelugaPresetAgent],
        db: sqlite(options.databasePath),
        providers: [],
      });
      context.onDispose(() => runtime.stop());

      const presetRouter = new Hono().route(
        CONVERSATION_PATH,
        createAgentRouter(BelugaPresetAgent),
      );

      const app = new Hono();
      app.use('*', async (c, next) => {
        c.header('Cache-Control', 'no-store');
        if (!(await auth.authenticate(c.req.raw))) {
          return c.json({ error: 'Unauthorized' }, 401);
        }
        await next();
      });

      mountAgentPresets(app, catalog.presets, capabilityMetadata);
      mountProviders(app, providers, catalog);

      app.get(CONVERSATION_PATH, async (c) =>
        c.json({
          ...catalog.list(),
          models: await availableModels(),
          defaultModel: catalog.defaultModel(),
        }),
      );

      app.post(CONVERSATION_PATH, bodyLimit({ maxSize: 2048 }), async (c) => {
        const input = createSessionSchema.safeParse(await c.req.json().catch(() => null));
        if (!input.success) {
          return c.json({ error: 'Invalid session configuration.' }, 400);
        }
        const {
          id,
          workspaceId,
          agentPresetId,
          agentPresetVersion,
          runSettings,
          accessMode = 'read-only',
        } = input.data;

        const existing = id && catalog.findSession(id);
        const presetId =
          agentPresetId ?? (existing ? existing.agentPresetId : catalog.presets.defaultId());

        function sameSession(session: NonNullable<ReturnType<typeof catalog.findSession>>) {
          return (
            session.workspaceId === workspaceId &&
            session.agentPresetId === presetId &&
            (agentPresetVersion === undefined || session.agentPresetVersion === agentPresetVersion)
          );
        }

        if (existing) {
          return sameSession(existing)
            ? c.json(existing, 201)
            : c.json(
                {
                  error: 'This session already uses a different configuration.',
                },
                409,
              );
        }

        if (!presetId) {
          return c.json({ error: 'Choose an available agent preset.' }, 409);
        }

        const defaultModel = catalog.defaultModel();
        const selected =
          runSettings ??
          (defaultModel ? { model: defaultModel, effort: 'default' as const } : undefined);
        if (!selected) {
          return c.json({ error: 'Choose a model or set a default in Settings.' }, 409);
        }
        if (!(await supportsRunSettings(selected))) {
          return c.json({ error: 'That model or effort is unavailable.' }, 400);
        }

        const workspace = catalog.find(workspaceId);
        if (!workspace) {
          return c.json({ error: 'Workspace not found.' }, 404);
        }
        if (!(await catalog.canStartSession(workspace))) {
          return c.json(
            {
              error: 'This workspace folder is no longer available on the Host.',
            },
            409,
          );
        }

        const preset = catalog.presets.get(presetId);
        if (!preset) {
          return c.json({ error: 'Invalid agent preset.' }, 400);
        }
        if (agentPresetVersion !== undefined && preset.version !== agentPresetVersion) {
          return c.json(
            {
              error: 'This preset has changed. Select it again before sending.',
            },
            409,
          );
        }
        if (preset.capabilities.some((id) => !capabilitiesById.has(id))) {
          return c.json({ error: 'A capability used by this preset is unavailable.' }, 503);
        }
        if (
          accessMode !== 'read-only' &&
          !availableAccessModes(capabilityMetadata, preset.capabilities).includes(accessMode)
        ) {
          return c.json({ error: 'That access mode is unavailable for this preset.' }, 400);
        }

        const created = catalog.createSession(
          workspaceId,
          preset,
          id ?? crypto.randomUUID(),
          selected,
          accessMode,
        );
        return sameSession(created)
          ? c.json(created, 201)
          : c.json({ error: 'This session already uses a different configuration.' }, 409);
      });

      app.put(`${CONVERSATION_PATH}/:id/run-settings`, bodyLimit({ maxSize: 2048 }), async (c) => {
        const settings = runSettingsSchema.safeParse(await c.req.json().catch(() => null));
        if (!settings.success || !(await supportsRunSettings(settings.data))) {
          return c.json({ error: 'That model or effort is unavailable.' }, 400);
        }
        if (!catalog.setRunSettings(c.req.param('id'), settings.data)) {
          return c.json({ error: 'Unknown session.' }, 404);
        }
        return c.json(settings.data);
      });

      app.put(`${CONVERSATION_PATH}/:id/access-mode`, bodyLimit({ maxSize: 2048 }), async (c) => {
        const input = accessModeInputSchema.safeParse(await c.req.json().catch(() => null));
        if (!input.success) {
          return c.json({ error: 'Invalid access mode.' }, 400);
        }
        const id = c.req.param('id');
        const preset = catalog.sessionPreset(id);
        if (!preset) {
          return c.json({ error: 'Unknown session.' }, 404);
        }
        const { mode } = input.data;
        if (
          mode !== 'read-only' &&
          !availableAccessModes(capabilityMetadata, preset.capabilities).includes(mode)
        ) {
          return c.json({ error: 'That access mode is unavailable for this preset.' }, 400);
        }
        catalog.setAccessMode(id, mode);
        return c.json({ mode });
      });

      app.post(`${CONVERSATION_PATH}/:id`, bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
        const id = c.req.param('id');
        const session = catalog.findSession(id);
        if (!session) {
          return c.json({ error: 'Unknown session' }, 404);
        }
        if (!(await supportsRunSettings(session.runSettings))) {
          return c.json(
            {
              error: 'Choose an available model and effort for this conversation.',
            },
            409,
          );
        }
        if (session.agentPresetCapabilities.some((id) => !capabilitiesById.has(id))) {
          return c.json({ error: 'A capability used by this preset is unavailable.' }, 503);
        }

        const message = await parseTextMessage(c.req.raw);
        if (!message) {
          return c.json({ error: 'Send a text message.' }, 400);
        }
        const response = await presetRouter.fetch(
          bindSession(c.req.raw, options.origin, id, message),
        );
        if (response.status === 202) {
          catalog.setFirstTitle(id, message.body.trim().slice(0, 60));
          const submissionId = await acceptedSubmissionId(response);
          if (submissionId !== undefined) {
            trajectory.recordAcceptedInput(id, submissionId, message.body);
          }
        }
        return response;
      });

      trajectory.mountRoutes(app);

      app.all(`${CONVERSATION_PATH}/:id/*`, (c) => {
        const id = c.req.param('id');
        const session = id && catalog.findSession(id);
        if (!session) {
          return c.json({ error: 'Unknown session' }, 404);
        }
        return presetRouter.fetch(c.req.raw);
      });

      context.provide('conversationHttp', {
        fetch: app.fetch,
        async abortConversations() {
          await Promise.all(
            catalog.list().sessions.map(({ id }) => init(BelugaPresetAgent, { id }).abort()),
          );
        },
      });
    },
  };
}

async function acceptedSubmissionId(response: Response) {
  const accepted: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  if (
    !accepted ||
    typeof accepted !== 'object' ||
    !('submissionId' in accepted) ||
    typeof accepted.submissionId !== 'string'
  ) {
    return;
  }

  return accepted.submissionId;
}

function createPresetAgent(
  catalog: Pick<WorkspaceCatalog, 'findSession' | 'sessionPreset' | 'sessionAccessMode'>,
  capabilitiesById: ReadonlyMap<string, AgentCapability>,
) {
  function BelugaPresetAgent() {
    const { sessionId } = useInitialData<v.InferOutput<typeof initialData>>();
    const settings = catalog.findSession(sessionId)?.runSettings;
    if (!settings) {
      throw new Error('Choose a model for this conversation.');
    }
    useModel(settings.model, {
      thinkingLevel: settings.effort === 'default' ? undefined : settings.effort,
    });
    const preset = catalog.sessionPreset(sessionId);
    if (!preset) {
      throw new Error('The selected agent preset version is unavailable.');
    }
    const capabilities = preset.capabilities.map((id) => {
      const capability = capabilitiesById.get(id);
      if (!capability) {
        throw new Error(`Agent capability is unavailable: ${id}`);
      }
      return capability;
    });
    const mode = catalog.sessionAccessMode(sessionId);
    const tools = capabilities.flatMap((capability) =>
      allowsTools(capability.metadata.access, mode) ? capability.createTools(sessionId) : [],
    );
    tools.forEach(useTool);
    return preset.instructions;
  }

  BelugaPresetAgent.initialData = initialData;
  return BelugaPresetAgent;
}

async function parseTextMessage(request: Request) {
  const value: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  if (
    !value ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    value.kind !== 'user' ||
    !('body' in value) ||
    typeof value.body !== 'string' ||
    !value.body.trim() ||
    ('attachments' in value && hasAttachments(value.attachments))
  ) {
    return undefined;
  }
  return {
    body: value.body,
    uid: 'uid' in value ? value.uid : undefined,
    idempotencyKey: 'idempotencyKey' in value ? value.idempotencyKey : undefined,
  };
}

function indexCapabilities(capabilities: readonly AgentCapability[]) {
  const byId = new Map<string, AgentCapability>();
  for (const capability of capabilities) {
    const { id } = capability.metadata;
    if (byId.has(id)) {
      throw new Error(`Duplicate agent capability: ${id}`);
    }
    byId.set(id, capability);
  }
  return byId;
}

function hasAttachments(value: unknown) {
  if (typeof value === 'string') {
    return value.length > 0;
  }
  return Boolean(value && typeof value === 'object' && 'length' in value && value.length);
}

function bindSession(
  request: Request,
  origin: string,
  id: string,
  message: { body: string; uid?: unknown; idempotencyKey?: unknown },
) {
  const headers = new Headers(request.headers);
  headers.delete('Content-Length');
  const incoming = new URL(request.url);
  const url = new URL(origin);
  // Flue uses this request URL for the client-facing stream receipt.
  url.pathname = incoming.pathname;
  url.search = incoming.search;
  return new Request(url, {
    method: 'POST',
    headers,
    signal: request.signal,
    body: JSON.stringify({
      kind: 'user',
      body: message.body,
      uid: message.uid,
      idempotencyKey: message.idempotencyKey,
      // Flue accepts creation data only when the request can create an instance.
      ...(typeof message.uid === 'string' ? {} : { initialData: { sessionId: id } }),
    }),
  });
}
