import { expect, test } from 'vitest';
import { type Plugin, createRuntime } from '../dist/index.js';

declare module '../dist/index.js' {
  interface Services {
    source: number;
    result: number;
    value: number;
    missing: number;
    one: number;
    two: number;
    resource: object;
    secret: number;
    counter: { value: number };
  }
}

test('dependencies activate before consumers, regardless of product order', async ({
  onTestFinished,
}) => {
  const events: string[] = [];
  const runtime = await createRuntime([
    {
      id: 'consumer',
      requires: ['source'],
      provides: ['result'],
      setup(context) {
        events.push('consumer');
        context.provide('result', context.get('source') + 1);
        context.onDispose(() => {
          events.push('consumer disposed');
        });
      },
    },
    {
      id: 'provider',
      provides: ['source'],
      async setup(context) {
        await Promise.resolve();
        events.push('provider');
        context.provide('source', 41);
        context.onDispose(async () => {
          await Promise.resolve();
          events.push('provider disposed');
        });
      },
    },
  ]);

  onTestFinished(() => runtime.dispose());

  expect(runtime.get('result')).toBe(42);
  expect(events).toEqual(['provider', 'consumer']);
  const disposal = runtime.dispose();
  expect(runtime.dispose()).toBe(disposal);
  await disposal;
  expect(events).toEqual(['provider', 'consumer', 'consumer disposed', 'provider disposed']);
  expect(() => runtime.get('result')).toThrow(/disposed/);
});

test.for([
  {
    name: 'a duplicate plugin ID',
    plugins: [{ id: 'same' }, { id: 'same' }],
    error: /Duplicate plugin: same/,
  },
  {
    name: 'a duplicate service',
    plugins: [
      { id: 'one', provides: ['value'] },
      { id: 'two', provides: ['value'] },
    ],
    error: /Duplicate service "value"/,
  },
  {
    name: 'a missing service',
    plugins: [{ id: 'consumer', requires: ['missing'] }],
    error: /requires missing service "missing"/,
  },
  {
    name: 'a dependency cycle',
    plugins: [
      { id: 'one', requires: ['two'], provides: ['one'] },
      { id: 'two', requires: ['one'], provides: ['two'] },
    ],
    error: /Cyclic plugin dependency/,
  },
] satisfies { name: string; plugins: Omit<Plugin, 'setup'>[]; error: RegExp }[])(
  'rejects $name before setup acquires resources',
  async ({ plugins, error }) => {
    let started = false;

    const setup = () => {
      started = true;
    };

    await expect(createRuntime(plugins.map((plugin) => ({ ...plugin, setup })))).rejects.toThrow(
      error,
    );
    expect(started).toBe(false);
  },
);

test('failed startup rolls back the failing plugin and its provider', async () => {
  const disposed: string[] = [];
  await expect(
    createRuntime([
      {
        id: 'resource',
        provides: ['resource'],
        setup(context) {
          context.provide('resource', {});
          context.onDispose(async () => {
            await Promise.resolve();
            disposed.push('resource');
          });
        },
      },
      {
        id: 'broken',
        requires: ['resource'],
        setup(context) {
          context.onDispose(() => {
            disposed.push('broken');
          });
          throw new Error('Startup failed');
        },
      },
    ]),
  ).rejects.toThrow(/Startup failed/);
  expect(disposed).toEqual(['broken', 'resource']);
});

test('service access and publication must match declarations', async () => {
  await expect(
    createRuntime([
      {
        id: 'reader',
        setup: (context) => {
          context.get('secret');
        },
      },
    ]),
  ).rejects.toThrow(/did not declare service "secret"/);
  await expect(
    createRuntime([{ id: 'writer', setup: (context) => context.provide('secret', 1) }]),
  ).rejects.toThrow(/cannot provide service "secret"/);
  await expect(createRuntime([{ id: 'empty', provides: ['value'], setup() {} }])).rejects.toThrow(
    /did not provide service "value"/,
  );
});

test('separate products own separate service instances', async ({ onTestFinished }) => {
  const plugin: Plugin = {
    id: 'counter',
    provides: ['counter'],
    setup: (context) => context.provide('counter', { value: 0 }),
  };
  const first = await createRuntime([plugin]);
  onTestFinished(() => first.dispose());
  const second = await createRuntime([plugin]);
  onTestFinished(() => second.dispose());

  first.get('counter').value = 1;
  expect(second.get('counter').value).toBe(0);
  await first.dispose();
  expect(second.get('counter').value).toBe(0);
});
