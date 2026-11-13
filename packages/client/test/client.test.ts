import { FolderIcon } from 'lucide-react';
import { expect, test } from 'vitest';
import { createDemoConversation } from '../src/features/conversation/data/demo.js';
import {
  createConversationViews,
  resolveConversationView,
} from '../src/features/conversation/view-registry.js';
import { createDemoWorkspaces } from '../src/features/workspaces/data/demo.js';
import { createDestinations } from '../src/workbench/destinations.js';
import { resolveLayout } from '../src/workbench/ui/columns.js';

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

  expect(() => client.createSession('missing')).toThrow(/Workspace not found/);
  expect(() => workspaces.addWorkspace('  ')).toThrow(/name/);
  expect(() => workspaces.addWorkspace(' EXAMPLE PROJECT ')).toThrow(/exists/);
});

test('contributions reject collisions and unregister without removing peers', () => {
  const registry = createDestinations();

  const component = () => null;

  const first = {
    id: 'a',
    label: 'A',
    icon: FolderIcon,
    path: '/a',
    component,
    order: 0,
  };
  let updates = 0;
  const unsubscribe = registry.subscribe(() => updates++);
  const remove = registry.register(first);
  registry.register({ ...first, id: 'b', path: '/b' });
  const removePanel = registry.registerPanel({
    id: 'files',
    label: 'Files',
    description: 'Workspace files',
    component,
  });

  expect(() => registry.register({ ...first, id: 'c' })).toThrow(/Duplicate/);
  expect(() =>
    registry.registerPanel({
      id: 'files',
      label: 'Duplicate',
      description: 'Duplicate panel',
      component,
    }),
  ).toThrow(/Duplicate/);
  remove();

  removePanel();
  expect(registry.getSnapshot().map((item) => item.id)).toEqual(['b']);
  expect(registry.getPanels().length).toBe(0);
  expect(updates).toBe(5);
  unsubscribe();
});

test('context panels preserve a usable center or use an overlay', () => {
  for (const width of [268, 323, 588, 716, 768, 972, 1024, 1228, 1868]) {
    for (const collapsed of [true, false]) {
      const layout = resolveLayout(width, collapsed, 280, true);
      expect(layout.panelOverlay).toBe(layout.panel === 0);
      expect(layout.panel).toBeGreaterThanOrEqual(layout.panelOverlay ? 0 : 300);
      expect(width - layout.sidebar - layout.panel).toBeGreaterThanOrEqual(
        layout.panelOverlay ? 0 : 400,
      );
    }
  }

  expect(resolveLayout(1228, false, 999, false).sidebar).toBe(420);
  expect(resolveLayout(1228, false, 1, false).sidebar).toBe(264);
  expect(resolveLayout(1228, true, 280, false).sidebar).toBe(0);
});

test('conversation views fall back to Chat when a feature unregisters', () => {
  const views = createConversationViews();

  const component = () => null;

  views.register({ id: 'chat', label: 'Chat', component, composer: true });
  const remove = views.register({
    id: 'trajectory',
    label: 'Trajectory',
    component,
    composer: false,
  });
  expect(resolveConversationView(views.getSnapshot(), 'trajectory')?.composer).toBe(false);
  expect(() =>
    views.register({
      id: 'trajectory',
      label: 'Duplicate',
      component,
      composer: true,
    }),
  ).toThrow(/Duplicate/);
  remove();
  expect(resolveConversationView(views.getSnapshot(), 'trajectory')?.id).toBe('chat');
  expect(resolveConversationView(views.getSnapshot(), 'unknown')?.id).toBe('chat');
});
