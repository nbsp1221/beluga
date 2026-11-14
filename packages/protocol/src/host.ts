import { z } from 'zod';

export const HOST_STATUS_PATH = '/api/status';
export const CONVERSATION_PATH = '/api/conversations';
export const AGENT_PRESETS_PATH = '/api/agent-presets';
export const PROVIDERS_PATH = '/api/providers';
export const AUTH_PATH = '/api/auth';
export const DESKTOP_CONNECTIONS_PATH = '/api/desktop/connections';
export const WORKSPACES_PATH = '/api/workspaces';
export const WORKSPACE_FOLDERS_PATH = `${WORKSPACES_PATH}/folders`;

// The explicitly supported product routes are shared by Host registration and Desktop forwarding.
export const productRoutes = {
  listConversations: { method: 'GET', path: CONVERSATION_PATH },
  createConversation: { method: 'POST', path: CONVERSATION_PATH },
  readConversation: { method: 'GET', path: `${CONVERSATION_PATH}/:id` },
  sendMessage: { method: 'POST', path: `${CONVERSATION_PATH}/:id` },
  abortConversation: { method: 'POST', path: `${CONVERSATION_PATH}/:id/abort` },
  setRunSettings: { method: 'PUT', path: `${CONVERSATION_PATH}/:id/run-settings` },
  setAccessMode: { method: 'PUT', path: `${CONVERSATION_PATH}/:id/access-mode` },
  usage: { method: 'GET', path: `${CONVERSATION_PATH}/:id/usage` },
  trajectory: { method: 'GET', path: `${CONVERSATION_PATH}/:id/trajectory` },
  modelInput: { method: 'GET', path: `${CONVERSATION_PATH}/:id/trajectory/:submissionId/:modelId` },
  listPresets: { method: 'GET', path: AGENT_PRESETS_PATH },
  createPreset: { method: 'POST', path: AGENT_PRESETS_PATH },
  setDefaultPreset: { method: 'PUT', path: `${AGENT_PRESETS_PATH}/default` },
  revisePreset: { method: 'PUT', path: `${AGENT_PRESETS_PATH}/:id` },
  listProviders: { method: 'GET', path: PROVIDERS_PATH },
  connectProvider: { method: 'POST', path: PROVIDERS_PATH },
  connectCodex: { method: 'PUT', path: `${PROVIDERS_PATH}/openai-codex` },
  disconnectProvider: { method: 'DELETE', path: `${PROVIDERS_PATH}/:id` },
  setDefaultModel: { method: 'PUT', path: `${PROVIDERS_PATH}/default-model` },
  browseFolders: { method: 'GET', path: WORKSPACE_FOLDERS_PATH },
  addWorkspace: { method: 'POST', path: WORKSPACES_PATH },
} as const;
export const trajectorySearchLimit = 512;
export const trajectorySearchSchema = z.string().trim().toLowerCase().max(trajectorySearchLimit);

export const trajectoryStatusSchema = z.enum([
  'in-progress',
  'completed',
  'failed',
  'interrupted',
  'unavailable',
]);
export const trajectoryRecordSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('system'),
    text: z.string(),
    initial: z.boolean(),
    modelRequestId: z.string(),
    timestamp: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('user'),
    text: z.string(),
    timestamp: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('assistant'),
    text: z.string(),
    timestamp: z.string().optional(),
    endedAt: z.string().optional(),
    firstOutputAt: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    purpose: z.enum(['agent', 'compaction', 'compaction_prefix']).optional(),
    compactionId: z.string().optional(),
    contextCompacted: z.literal(true).optional(),
    contextSample: z
      .object({
        model: z.string(),
        revision: z.number().int().nonnegative(),
        contextWindow: z.number().int().positive(),
        inputTokens: z.number().int().positive().optional(),
      })
      .optional(),
    durationMs: z.number().optional(),
    usage: z.record(z.string(), z.number()).optional(),
    status: trajectoryStatusSchema,
  }),
  z.object({
    id: z.string(),
    kind: z.literal('compaction'),
    text: z.string(),
    reason: z.enum(['threshold', 'overflow', 'manual']),
    status: trajectoryStatusSchema,
    timestamp: z.string(),
    endedAt: z.string().optional(),
    durationMs: z.number().optional(),
    estimatedTokens: z.number().nonnegative(),
    messagesBefore: z.number().int().nonnegative().optional(),
    messagesAfter: z.number().int().nonnegative().optional(),
    summaryTokens: z.number().int().nonnegative().optional(),
    error: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('tool'),
    name: z.string(),
    modelRequestId: z.string().optional(),
    timestamp: z.string().optional(),
    endedAt: z.string().optional(),
    schema: z.unknown().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    durationMs: z.number().optional(),
    status: trajectoryStatusSchema,
  }),
]);
export const trajectoryHistorySchema = z.array(
  z.object({
    id: z.string(),
    status: trajectoryStatusSchema,
    records: z.array(trajectoryRecordSchema),
    settledAt: z.string().optional(),
    error: z.string().optional(),
  }),
);

export type TrajectoryRequest = z.infer<typeof trajectoryHistorySchema>[number];
export type TrajectoryRecord = TrajectoryRequest['records'][number];
export type TrajectoryStatus = TrajectoryRequest['status'];

export const trajectoryPageSchema = z.object({
  requests: z.array(
    z.object({
      turn: z.number().int().positive(),
      precedingModelRequests: z.number().int().nonnegative(),
      request: trajectoryHistorySchema.element,
    }),
  ),
  before: z.number().int().positive().nullable(),
});

export type TrajectoryPage = z.infer<typeof trajectoryPageSchema>;

export const conversationContextSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unavailable') }),
  z.object({ status: z.literal('compacting') }),
  z.object({
    status: z.literal('available'),
    model: z.string(),
    inputTokens: z.number().int().positive(),
    contextWindow: z.number().int().positive(),
    estimatedTokens: z
      .object({
        systemPrompt: z.number().int().nonnegative(),
        tools: z.number().int().nonnegative(),
        messages: z.number().int().nonnegative(),
      })
      .optional(),
  }),
]);

export type ConversationContext = z.infer<typeof conversationContextSchema>;

export const conversationUsageSchema = z.object({
  turns: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  modelMs: z.number().nonnegative().nullable(),
  toolMs: z.number().nonnegative().nullable(),
  averageFirstOutputMs: z.number().nonnegative().nullable(),
  outputTokensPerSecond: z.number().nonnegative().nullable(),
  tokens: z.number().nonnegative(),
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  context: conversationContextSchema.optional(),
});

export type ConversationUsage = z.infer<typeof conversationUsageSchema>;

export const trajectoryModelInputSchema = z.object({
  systemPrompt: z.string().optional(),
  messages: z.array(z.unknown()),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      parameters: z.unknown().optional(),
    }),
  ),
});

export type TrajectoryModelInput = z.infer<typeof trajectoryModelInputSchema>;

export const trajectoryModelInputResponseSchema = trajectoryModelInputSchema
  .extend({ messageIds: z.array(z.string()) })
  .refine(({ messageIds, messages }) => messageIds.length === messages.length);

export type TrajectoryModelInputResponse = z.infer<typeof trajectoryModelInputResponseSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string().min(1),
});

export const workspaceFoldersSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  folders: z.array(z.object({ name: z.string(), path: z.string() })),
});

export const agentPresetIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/);
export const agentPresetInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
  instructions: z.string().trim().min(1).max(12_000),
  capabilities: z.array(z.string().min(1).max(80)).max(64),
});
export const agentPresetSchema = agentPresetInputSchema.extend({
  id: agentPresetIdSchema,
  version: z.number().int().positive(),
});
export const agentCapabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  access: z.enum(['files', 'file-write', 'shell']).optional(),
});

export const accessModeSchema = z.enum(['read-only', 'workspace-write', 'full-access']);
export const accessModeInputSchema = z.strictObject({ mode: accessModeSchema });

export type AccessMode = z.infer<typeof accessModeSchema>;

export function availableAccessModes(
  capabilities: readonly z.infer<typeof agentCapabilitySchema>[],
  selected: readonly string[],
): AccessMode[] {
  const access = capabilities
    .filter(({ id }) => selected.includes(id))
    .map((capability) => capability.access);
  if (!access.some(Boolean)) {
    return [];
  }

  const modes: AccessMode[] = ['read-only'];
  if (access.includes('file-write')) {
    modes.push('workspace-write');
  }
  if (access.includes('shell')) {
    modes.push('full-access');
  }
  return modes;
}

export const agentPresetsSchema = z.object({
  presets: z.array(agentPresetSchema),
  capabilities: z.array(agentCapabilitySchema),
  defaultPresetId: agentPresetIdSchema.nullable(),
});
export const defaultAgentPresetSchema = z.strictObject({
  presetId: agentPresetIdSchema.nullable(),
});
export const reviseAgentPresetSchema = agentPresetInputSchema.extend({
  version: z.number().int().positive(),
});

export const effortSchema = z.enum([
  'default',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
export const runSettingsSchema = z.strictObject({
  model: z.string().min(1).max(256),
  effort: effortSchema,
});
const modelOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  efforts: z.array(effortSchema),
  providerName: z.string(),
});
export const defaultModelSchema = z.string().min(1).max(256).nullable();

export const connectProviderSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.url({ protocol: /^https?$/ }).max(2048),
  apiKey: z.string().trim().max(4096),
  models: z.array(z.string().trim().min(1).max(200)).max(256),
});
const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['codex', 'openai-compatible']),
  status: z.enum(['connected', 'disconnected', 'missing-login']),
  baseUrl: z.string().optional(),
  models: z.array(modelOptionSchema),
});
export const providerSettingsSchema = z.object({
  providers: z.array(providerSchema),
  defaultModel: defaultModelSchema,
});

export const createSessionSchema = z.strictObject({
  id: z.uuid().optional(),
  workspaceId: z.string().min(1),
  agentPresetId: agentPresetIdSchema.optional(),
  agentPresetVersion: z.number().int().positive().optional(),
  runSettings: runSettingsSchema.optional(),
  accessMode: accessModeSchema.optional(),
});
export const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  workspaceId: z.string(),
  agentPresetId: agentPresetIdSchema,
  agentPresetName: z.string(),
  agentPresetVersion: z.number().int().positive(),
  agentPresetCapabilities: z.array(z.string()),
  runSettings: runSettingsSchema,
  accessMode: accessModeSchema,
});
export const conversationCatalogSchema = z.object({
  workspaces: z.array(workspaceSchema),
  sessions: z.array(sessionSummarySchema),
  models: z.array(modelOptionSchema),
  defaultModel: z.string().nullable(),
});

export const hostStatusSchema = z.object({
  status: z.literal('ready'),
});

export type HostStatus = z.infer<typeof hostStatusSchema>;
export type WorkspaceFolders = z.infer<typeof workspaceFoldersSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type AgentPresetId = z.infer<typeof agentPresetIdSchema>;
export type AgentPresetInput = z.infer<typeof agentPresetInputSchema>;
export type AgentPreset = z.infer<typeof agentPresetSchema>;
export type AgentCapabilityMetadata = z.infer<typeof agentCapabilitySchema>;
export type AgentPresets = z.infer<typeof agentPresetsSchema>;
export type RunSettings = z.infer<typeof runSettingsSchema>;
export type ModelOption = z.infer<typeof modelOptionSchema>;
export type ConnectProvider = z.infer<typeof connectProviderSchema>;
export type ProviderConnection = z.infer<typeof providerSchema>;
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;

export { matchesRecord, payloadText, recordTitle, resultText } from './trajectory-search.js';
