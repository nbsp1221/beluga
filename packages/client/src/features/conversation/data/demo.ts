import type { WorkspaceClient } from '../../workspaces/contract.js';
import type { ConversationClient, ConversationSnapshot, Session } from '../contract.js';
import { createStore } from '../../../state/store.js';

export function createDemoConversation(workspaces: WorkspaceClient): ConversationClient {
  const { getSnapshot, publish, subscribe } = createStore<ConversationSnapshot>({
    sessions: [
      {
        id: 'welcome',
        workspaceId: 'example',
        title: 'New session',
        messages: [],
        draft: '',
      },
      {
        id: 'sample',
        workspaceId: 'example',
        title: 'Explore the project',
        draft: '',
        messages: [
          {
            id: 'sample-user',
            role: 'user',
            text: 'Explain how this project is organized.',
          },
          {
            id: 'sample-assistant',
            role: 'assistant',
            parts: [
              {
                type: 'text',
                id: 'reply',
                text: 'The web app assembles client plugins. Workbench owns the frame and navigation; Conversation owns sessions and the composer. The Host has its own plugin graph.',
                streaming: false,
              },
            ],
          },
        ],
      },
    ],
  });

  const update = (id: string, change: (session: Session) => Session) => {
    const snapshot = getSnapshot();
    if (!snapshot.sessions.some((session) => session.id === id)) {
      throw new Error('Session not found');
    }
    publish({
      ...snapshot,
      sessions: snapshot.sessions.map((session) => (session.id === id ? change(session) : session)),
    });
  };

  return {
    mode: 'demo',
    getSnapshot,
    subscribe,
    createSession(workspaceId) {
      if (!workspaceId || !workspaces.getSnapshot().some(({ id }) => id === workspaceId)) {
        throw new Error('Workspace not found');
      }
      const id = crypto.randomUUID();
      const snapshot = getSnapshot();
      publish({
        ...snapshot,
        sessions: [
          { id, workspaceId, title: 'New session', messages: [], draft: '' },
          ...snapshot.sessions,
        ],
      });
      return id;
    },
    setDraft(id, draft) {
      update(id, (session) => ({ ...session, draft }));
    },
    send(id) {
      return new Promise<void>((resolve) => {
        update(id, (session) => {
          if (!session.draft.trim()) {
            return session;
          }
          const text = session.draft.trim();
          const sentAt = Date.now();
          return {
            ...session,
            title: session.messages.length ? session.title : text.slice(0, 60),
            draft: '',
            messages: [
              ...session.messages,
              { id: crypto.randomUUID(), role: 'user', text, sentAt },
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                parts: [{ type: 'text', id: 'reply', text: 'Message received.', streaming: false }],
                completedAt: sentAt,
              },
            ],
          };
        });
        resolve();
      });
    },
  };
}
