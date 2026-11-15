import { FlueExecutionError } from '@flue/sdk';
import {
  CONVERSATION_PATH,
  type SessionSummary,
  accessModeInputSchema,
  availableAccessModes,
  conversationUsageSchema,
  runSettingsSchema,
  sessionSummarySchema,
} from '@workspace/protocol/host';
import { readPreference, writePreference } from '@workspace/ui/lib/browser-storage';
import { v4 as uuid } from 'uuid';
import type { AgentPresetsClient } from '../../agent-presets/contract.js';
import type { ModelProvidersClient } from '../../model-providers/contract.js';
import type { WorkspaceClient } from '../../workspaces/contract.js';
import type { ConversationClient, ConversationSnapshot, Session } from '../contract.js';
import { createStore } from '../../../state/store.js';
import { type HostRequest, HostRequestError } from '../../../transport/host-http.js';
import { activeSubmissionId, connectConversation, conversationMessages } from './flue-client.js';

export function createConnectedConversation({
  signal,
  request,
  fetchHost,
  prefix,
  workspaceStorageKey = 'beluga:last-workspace',
  sessions,
  workspaces,
  agentPresets,
  modelProviders,
}: {
  signal: AbortSignal;
  request: HostRequest;
  fetchHost: typeof fetch;
  prefix?: string;
  workspaceStorageKey?: string;
  sessions: readonly SessionSummary[];
  workspaces: WorkspaceClient;
  agentPresets: AgentPresetsClient;
  modelProviders: ModelProvidersClient;
}): ConversationClient {
  let lastWorkspaceId = readPreference(workspaceStorageKey);

  const rememberWorkspace = (id: string | null) => {
    if (!id || id === lastWorkspaceId) {
      return;
    }
    lastWorkspaceId = id;
    writePreference(workspaceStorageKey, id);
  };

  const preferredWorkspace = (sessions: readonly Session[]) => {
    const catalog = workspaces.getSnapshot();
    return (
      catalog.find(({ id }) => id === lastWorkspaceId)?.id ??
      sessions.find((session) => !session.isDraft)?.workspaceId ??
      catalog.at(-1)?.id ??
      null
    );
  };

  const emptySavedSession = (session: Omit<Session, 'messages' | 'draft'>): Session => ({
    ...session,
    messages: [],
    draft: '',
  });

  function draftSession(workspaceId: string | null): Session {
    return {
      id: uuid(),
      workspaceId,
      title: null,
      agentPresetId: agentPresets.getSnapshot().defaultPresetId ?? undefined,
      isDraft: true,
      draft: '',
      messages: [],
    };
  }

  const savedSessions = sessions.map(emptySavedSession);
  const initial = draftSession(preferredWorkspace(savedSessions));
  const { getSnapshot, publish, subscribe } = createStore<ConversationSnapshot>({
    sessions: [initial, ...savedSessions],
  });

  const update = (id: string, change: (session: Session) => Session) => {
    const snapshot = getSnapshot();
    publish({
      ...snapshot,
      sessions: snapshot.sessions.map((session) => (session.id === id ? change(session) : session)),
    });
  };

  const draftBindings: DraftBindings = new Map();

  const connect = (id: string) => connectConversation(id, fetchHost, prefix);

  let activeObservation: { id: string; refresh(): void } | undefined;
  const usageEpochs = new Map<string, number>();

  const usageEpoch = (id: string) => usageEpochs.get(id) ?? 0;

  return {
    mode: 'connected',
    initialSessionId: initial.id,
    getSnapshot,
    subscribe,
    createSession(workspaceId) {
      const session = draftSession(workspaceId ?? preferredWorkspace(getSnapshot().sessions));
      rememberWorkspace(session.workspaceId);
      const snapshot = getSnapshot();
      publish({ ...snapshot, sessions: [session, ...snapshot.sessions] });
      return session.id;
    },
    setDraftConfiguration(id, workspaceId, agentPresetId) {
      if (draftBindings.has(id)) {
        return;
      }
      if (!getSnapshot().sessions.some((session) => session.id === id && session.isDraft)) {
        return;
      }
      rememberWorkspace(workspaceId);
      update(id, (session) => ({
        ...session,
        workspaceId,
        agentPresetId,
        accessMode:
          session.workspaceId === workspaceId && session.agentPresetId === agentPresetId
            ? session.accessMode
            : 'read-only',
      }));
    },
    async setRunSettings(id, settings) {
      const session = getSnapshot().sessions.find((item) => item.id === id);
      if (!session || session.savingDraft) {
        return;
      }
      const runSettings = session.isDraft
        ? settings
        : runSettingsSchema.parse(
            await request(
              `${CONVERSATION_PATH}/${encodeURIComponent(id)}/run-settings`,
              settings,
              'PUT',
            ),
          );
      update(id, (item) => {
        if (item.runSettings?.model === runSettings.model) {
          return { ...item, runSettings };
        }
        usageEpochs.set(id, usageEpoch(id) + 1);
        return {
          ...item,
          runSettings,
          usage: item.usage && { ...item.usage, context: undefined },
        };
      });
    },
    async setAccessMode(id, mode) {
      const session = getSnapshot().sessions.find((item) => item.id === id);
      if (!session || draftBindings.has(id)) {
        return;
      }
      const accessMode = session.isDraft
        ? mode
        : accessModeInputSchema.parse(
            await request(
              `${CONVERSATION_PATH}/${encodeURIComponent(id)}/access-mode`,
              { mode },
              'PUT',
            ),
          ).mode;
      update(id, (item) => ({ ...item, accessMode }));
    },
    setDraft(id, draft) {
      update(id, (session) => ({ ...session, draft }));
    },
    observeSession(id) {
      rememberWorkspace(
        getSnapshot().sessions.find((session) => session.id === id)?.workspaceId ?? null,
      );

      const observation = connect(id).observe({
        signal,
        live: 'sse',
      });
      const current = { id, refresh: () => observation.refresh() };
      activeObservation = current;
      const unsubscribe = observation.subscribe(() => {
        const { conversation: history } = observation.getSnapshot();
        if (!history) {
          return;
        }
        const submissionId = activeSubmissionId(history);
        const messages = conversationMessages(history, submissionId);
        const first = messages.find((message) => message.role === 'user')?.text;
        update(id, (session) => ({
          ...session,
          title: session.title ?? first?.trim().slice(0, 60) ?? null,
          messages,
          activeSubmissionId: submissionId,
        }));
      });

      return () => {
        unsubscribe();
        observation.close();
        if (activeObservation === current) {
          activeObservation = undefined;
        }
      };
    },
    observeUsage(id) {
      const controller = new AbortController();
      const stopSignal = AbortSignal.any([signal, controller.signal]);
      const path = `${CONVERSATION_PATH}/${encodeURIComponent(id)}/usage`;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let etag: string | null = null;
      let previousEpoch: number | undefined;

      async function refresh() {
        const epoch = usageEpoch(id);
        try {
          const response = await fetchHost(path, {
            signal: stopSignal,
            ...(etag && epoch === previousEpoch ? { headers: { 'If-None-Match': etag } } : {}),
          });
          if (response.ok) {
            const usage = conversationUsageSchema.parse(await response.json());
            if (!stopSignal.aborted && epoch === usageEpoch(id)) {
              etag = response.headers.get('ETag');
              previousEpoch = epoch;
              update(id, (session) => ({ ...session, usage }));
            }
          }
        } catch {
          // Keep the last known counts while the connection recovers.
        } finally {
          if (!stopSignal.aborted) {
            timer = setTimeout(() => void refresh(), 1500);
          }
        }
      }

      void refresh();
      return () => {
        controller.abort();
        clearTimeout(timer);
      };
    },
    ...createSubmissionClient({
      signal,
      request,
      connect,
      draftBindings,
      getSnapshot,
      update,
      agentPresets,
      modelProviders,
      refreshActive: (id) => {
        if (activeObservation?.id === id) {
          activeObservation.refresh();
        }
      },
    }),
  };
}

type UpdateSession = (id: string, change: (session: Session) => Session) => void;

type DraftBindings = Map<
  string,
  {
    id: string;
    workspaceId: string;
    agentPresetId: string;
    agentPresetVersion: number;
    runSettings?: Session['runSettings'];
    accessMode?: Session['accessMode'];
  }
>;

function createSubmissionClient({
  signal,
  request,
  connect,
  draftBindings,
  getSnapshot,
  update,
  agentPresets,
  modelProviders,
  refreshActive,
}: {
  signal: AbortSignal;
  request: HostRequest;
  connect: (id: string) => ReturnType<typeof connectConversation>;
  draftBindings: DraftBindings;
  getSnapshot: () => ConversationSnapshot;
  update: UpdateSession;
  agentPresets: AgentPresetsClient;
  modelProviders: ModelProvidersClient;
  refreshActive: (id: string) => void;
}): Pick<ConversationClient, 'send' | 'stop'> {
  const pendingDeliveries = new Map<string, { text: string; key: string }>();

  async function saveDraftSession(id: string, session: Session) {
    if (!session.workspaceId) {
      throw new Error('Choose a workspace to start.');
    }
    const catalog = agentPresets.getSnapshot();
    const { defaultModel } = modelProviders.getSnapshot();
    const preset = catalog.presets.find((item) => item.id === session.agentPresetId);
    if (!preset) {
      throw new Error('Choose an available agent preset.');
    }
    const accessModes = availableAccessModes(catalog.capabilities, preset.capabilities);

    // Keep the first configuration bound until the Host accepts or rejects it.
    const binding = draftBindings.get(id) ?? {
      id,
      workspaceId: session.workspaceId,
      agentPresetId: preset.id,
      agentPresetVersion: preset.version,
      accessMode:
        session.accessMode && accessModes.includes(session.accessMode)
          ? session.accessMode
          : 'read-only',
      runSettings:
        session.runSettings ??
        (defaultModel ? { model: defaultModel, effort: 'default' } : undefined),
    };

    draftBindings.set(id, binding);
    update(id, (draft) => ({ ...draft, savingDraft: true }));
    try {
      const created = sessionSummarySchema.parse(await request(CONVERSATION_PATH, binding));
      draftBindings.delete(id);
      update(id, (draft) => ({
        ...draft,
        ...created,
        isDraft: false,
        savingDraft: false,
      }));
    } catch (error) {
      // An uncertain transport outcome keeps the original binding available for retry.
      if (error instanceof HostRequestError) {
        draftBindings.delete(id);
        update(id, (draft) => ({ ...draft, savingDraft: false }));
        if (error.status === 409) {
          await agentPresets.refresh().catch(() => undefined);
        }
      }
      throw error;
    }
  }

  return {
    async send(id, options) {
      const snapshot = getSnapshot();
      if (options.attachments.length) {
        throw new Error('Attachments are not connected.');
      }
      const session = snapshot.sessions.find((session) => session.id === id);
      const text = session?.draft.trim();
      if (!session || !text) {
        return;
      }
      if (session.isDraft) {
        await saveDraftSession(id, session);
      }

      // Reuse the delivery key when retrying the same text.
      const existing = pendingDeliveries.get(id);
      const delivery = existing?.text === text ? existing : { text, key: uuid() };
      pendingDeliveries.set(id, delivery);
      const client = connect(id);
      const receipt = await client.send({
        message: { kind: 'user', body: text },
        idempotencyKey: delivery.key,
        signal,
      });

      pendingDeliveries.delete(id);
      update(id, (session) => ({
        ...session,
        draft: session.draft.trim() === text ? '' : session.draft,
      }));
      refreshActive(id);

      try {
        await client.wait(receipt, { signal });
      } catch (error) {
        if (!(error instanceof FlueExecutionError && error.failure === 'aborted')) {
          throw error;
        }
      }
    },
    async stop(id, submissionId) {
      const client = connect(id);
      const { aborted } = await client.abort({ signal });
      if (aborted) {
        try {
          await client.read(submissionId, { signal });
        } catch (error) {
          if (!(error instanceof FlueExecutionError && error.failure === 'aborted')) {
            throw error;
          }
        }
      }
      refreshActive(id);
    },
  };
}
