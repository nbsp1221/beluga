import { expect, test } from 'vitest';
import { createDemoConversation } from '../src/features/conversation/data/demo.js';
import { createDemoWorkspaces } from '../src/features/workspaces/data/demo.js';

test('session drafts remain isolated and sending clears only that draft', async () => {
  const workspaces = createDemoWorkspaces();
  const client = createDemoConversation(workspaces);
  const id = await client.createSession('example');
  client.setDraft('welcome', 'keep me');
  client.setDraft(id, 'hello');

  await client.send(id, {
    mode: 'standard',
    attachments: [],
  });

  const sessions = client.getSnapshot().sessions;
  expect(sessions.find((item) => item.id === 'welcome')?.draft).toBe('keep me');
  expect(sessions.find((item) => item.id === id)?.draft).toBe('');
  expect(sessions.find((item) => item.id === id)?.messages).toHaveLength(2);
});

test('rejects a demo conversation in an unknown workspace', () => {
  const client = createDemoConversation(createDemoWorkspaces());
  expect(() => client.createSession('missing')).toThrow(/Workspace not found/);
});

test.for([
  { name: '  ', error: /name/ },
  { name: ' EXAMPLE PROJECT ', error: /exists/ },
])('rejects an invalid demo workspace name matching $error', ({ name, error }) => {
  const workspaces = createDemoWorkspaces();
  expect(() => workspaces.addWorkspace(name)).toThrow(error);
});
