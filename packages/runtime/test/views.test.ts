import { expect, test } from 'vitest';
import { createViews } from '../dist/react.js';

test('views notify on changes and cannot silently replace an owner', () => {
  const views = createViews();

  const component = () => null;

  let changes = 0;
  const unsubscribe = views.subscribe(() => changes++);
  const remove = views.register('main', component);
  expect(views.get('main')).toBe(component);
  expect(changes).toBe(1);
  expect(() => views.register('main', () => null)).toThrow(/already registered/);
  remove();
  expect(views.get('main')).toBe(undefined);
  expect(changes).toBe(2);
  remove();
  expect(changes).toBe(2);
  unsubscribe();
  views.register('main', component);
  expect(changes).toBe(2);
});

test('an old disposer cannot remove a later registration of the same component', () => {
  const views = createViews();

  const component = () => null;

  const oldRemove = views.register('main', component);
  oldRemove();
  const remove = views.register('main', component);
  oldRemove();
  expect(views.get('main')).toBe(component);
  remove();
  expect(views.get('main')).toBe(undefined);
});
