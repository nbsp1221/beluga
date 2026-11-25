import { FolderIcon } from 'lucide-react';
import { expect, test } from 'vitest';
import { createDestinations } from '../src/workbench/destinations.js';

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
