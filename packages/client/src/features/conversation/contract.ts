import '@workspace/runtime';
import type {
  AccessMode,
  AgentPresetId,
  ConversationUsage,
  RunSettings,
} from '@workspace/protocol/host';
import type { ComponentType } from 'react';
import type { ReadStore } from '../../state/store.js';

export type AssistantMessagePart =
  | { type: 'text'; id: string; text: string; streaming: boolean }
  | { type: 'reasoning'; id: string; text: string; streaming: boolean }
  | {
      type: 'tool';
      id: string;
      name: string;
      input: unknown;
      status: 'running' | 'completed' | 'failed' | 'incomplete';
      output?: unknown;
      error?: string;
    };

export type TurnActivity =
  | { state: 'running'; startedAt?: number }
  | { state: 'completed' | 'failed' | 'aborted'; durationMs?: number };

export type Message =
  | { id: string; role: 'user'; text: string; sentAt?: number }
  | {
      id: string;
      role: 'assistant';
      parts: readonly AssistantMessagePart[];
      activity?: TurnActivity;
      completedAt?: number;
    };

export interface Session {
  id: string;
  workspaceId: string | null;
  title: string | null;
  agentPresetId?: AgentPresetId;
  agentPresetName?: string;
  agentPresetVersion?: number;
  agentPresetCapabilities?: readonly string[];
  isDraft?: boolean;
  savingDraft?: boolean;
  runSettings?: RunSettings;
  accessMode?: AccessMode;
  activeSubmissionId?: string;
  usage?: ConversationUsage;
  messages: readonly Message[];
  draft: string;
}

export const sessionTitle = ({ title }: Session) => title ?? 'New session';

export interface ConversationSnapshot {
  sessions: readonly Session[];
}

export interface SendOptions {
  mode: string;
  attachments: readonly string[];
}

// Client projection contract. A future transport can publish Host snapshots here.
export interface ConversationClient {
  readonly mode: 'demo' | 'connected';
  readonly initialSessionId?: string;
  getSnapshot(this: void): ConversationSnapshot;
  subscribe(this: void, listener: () => void): () => void;
  createSession(this: void, workspaceId: string | null): string | Promise<string>;
  setDraftConfiguration?(
    this: void,
    id: string,
    workspaceId: string | null,
    presetId?: string,
  ): void;
  setRunSettings?(this: void, id: string, settings: RunSettings): Promise<void>;
  setAccessMode?(this: void, id: string, mode: AccessMode): Promise<void>;
  observeSession?(this: void, id: string): () => void;
  observeUsage?(this: void, id: string): () => void;
  setDraft(this: void, sessionId: string, text: string): void;
  send(this: void, sessionId: string, options: SendOptions): Promise<void>;
  stop?(this: void, sessionId: string, submissionId: string): Promise<void>;
}

export interface ConversationView {
  id: string;
  label: string;
  component: ComponentType<{ session: Session; active?: boolean }>;
  prepare?: (session: Session) => void;
  composer: boolean | 'floating';
}

export interface ConversationViews extends ReadStore<readonly ConversationView[]> {
  register(view: ConversationView): () => void;
}

declare module '@workspace/runtime' {
  interface Services {
    conversation: ConversationClient;
    conversationViews: ConversationViews;
  }
}
