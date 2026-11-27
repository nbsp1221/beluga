import { unlinkSync } from 'node:fs';
import { chmod, mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import {
  type DispatchReceipt,
  instrument,
  useAgentStart,
  useDelivery,
  useDispatchMessage,
} from '@flue/runtime';
import {
  AGENT_SKILLS_PATH,
  agentSkillsCapabilityId,
  productRoutes,
  skillListingSchema,
  trajectoryModelInputResponseSchema,
} from '@workspace/protocol/host';
import { type TestContext, expect, test, vi } from 'vitest';
import type { AgentCapability } from '../src/agent-capabilities/host.js';
import { fileReadCapability } from '../src/agent-capabilities/file/read/host.js';
import { linkDirectory, origin, readTrajectory, setupHarness } from './fixtures/harness.js';
import { fixtureProvider } from './fixtures/model-provider.js';

declare module '@workspace/runtime' {
  interface Services {
    fixtureJoinedSkill: AgentCapability;
  }
}

async function writeSkill(root: string, name: string, marker: string, flags = '') {
  const folder = join(root, name);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, 'SKILL.md'),
    `---\nname: "${name}"\ndescription: Find ${name}\n${flags}---\n\n${marker}\n`,
  );
  return folder;
}

async function submit(harness: Awaited<ReturnType<typeof setupHarness>>, id: string, body: string) {
  const client = harness.sdk(id);
  const start = harness.observed.length;
  const receipt = await client.send({ message: { kind: 'user', body } });
  await client.wait(receipt, { signal: AbortSignal.timeout(10_000) });
  return harness.observed.slice(start);
}

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('keeps applied skill bodies in place across ordinary follow-ups', async (context) => {
  const harness = await setupHarness(context);
  const marker = 'KEEP_REVIEW_RULE';
  await writeSkill(join(dirname(harness.databasePath), 'skills'), 'review', marker);
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset([agentSkillsCapabilityId]);
  const { id } = await harness.create(workspace.id, preset.id);
  await submit(harness, id, '/review review this change');

  for (const request of ['Continue', 'One more detail']) {
    const input = await submit(harness, id, request);
    expect(input.at(-1)?.skillInstructions.match(/KEEP_REVIEW_RULE/g)).toHaveLength(1);
  }
});

test('prefers the Git root skill when working in a nested folder', async (context) => {
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  context.onTestFinished(() => {
    warnings.mockRestore();
  });
  const harness = await setupHarness(context);
  const global = dirname(harness.databasePath);
  const shared = join(global, 'home', '.agents', 'skills');
  const host = join(global, 'skills');
  const project = join(harness.project, '.agents', 'skills');
  const nested = join(harness.project, 'docs', '.agents', 'skills');
  await writeFile(join(harness.project, '.git'), 'gitdir: /test/worktree');
  const hostReview = await writeSkill(host, 'review', 'HOST_BODY');
  await writeSkill(shared, 'review', 'SHARED_BODY');
  const projectReview = await writeSkill(project, 'review', 'PROJECT_BODY');
  await writeSkill(nested, 'review', 'NESTED_BODY');
  const outside = await writeSkill(join(harness.other, 'other-skills'), 'linked', 'OUTSIDE_BODY');
  const linked = join(project, 'linked');
  await linkDirectory(outside, linked);

  await harness.prepareWorkspace();
  const workspace = await harness.registerWorkspace(join(harness.project, 'docs'));
  const preset = await harness.createPreset([agentSkillsCapabilityId]);
  const session = await harness.create(workspace.id, preset.id);
  const automatic = await submit(
    harness,
    session.id,
    JSON.stringify({ tool: 'skill', name: 'review' }),
  );
  expect(automatic[0].instructions).toContain('- review: Find review');
  expect(automatic[0].instructions).not.toContain('linked');
  expect(automatic[0].skillInstructions).toBe('');
  expect(automatic[0].toolNames.sort()).toEqual(['skill', 'task']);
  expect(JSON.stringify(automatic.at(-1)?.result?.content)).toContain('PROJECT_BODY');
  expect(JSON.stringify(automatic.at(-1)?.result?.content)).not.toMatch(
    /HOST_BODY|SHARED_BODY|NESTED_BODY/,
  );
  expect(warnings).toHaveBeenCalledWith(
    expect.stringContaining(
      `uses ${join(projectReview, 'SKILL.md')}; shadowed ${join(hostReview, 'SKILL.md')}`,
    ),
  );
  expect(warnings).toHaveBeenCalledWith(
    expect.stringContaining(`${linked}: outside the project boundary.`),
  );
  const [turn] = await readTrajectory(
    harness.fetch(`${origin}/api/conversations/${session.id}/trajectory`),
  );
  const applied = turn.records.findLast(
    (record) => record.kind === 'assistant' && record.purpose === 'agent',
  );
  if (!applied) {
    throw new Error('Expected a model request for the loaded skill.');
  }
  const inputPath = productRoutes.modelInput.path
    .replace(':id', session.id)
    .replace(':submissionId', turn.id)
    .replace(':modelId', applied.id);
  const inputResponse = await harness.fetch(origin + inputPath);
  expect(inputResponse.ok).toBe(true);
  const input = trajectoryModelInputResponseSchema.parse(await inputResponse.json());
  expect(JSON.stringify(input.messages)).toContain('PROJECT_BODY');
  const repeated = await submit(
    harness,
    session.id,
    JSON.stringify({ tool: 'skill', name: 'review' }),
  );
  expect(JSON.stringify(repeated.at(-1)?.result?.content)).toContain('PROJECT_BODY');
  await writeSkill(project, 'review', 'EDITED_BODY');
  const edited = (await submit(harness, session.id, '/review check changes'))[0];
  expect(edited.skillInstructions.match(/EDITED_BODY/g)).toHaveLength(1);
  await rm(projectReview, { recursive: true });
  const [fallback] = await submit(harness, session.id, '/review now use the Host');
  expect(fallback.skillInstructions.match(/HOST_BODY/g)).toHaveLength(1);
});

test('prefers Host skills to shared global skills and falls back after restart', async (context) => {
  const harness = await setupHarness(context);
  const global = dirname(harness.databasePath);
  const hostReview = await writeSkill(join(global, 'skills'), 'review', 'HOST_BODY');
  await writeSkill(join(global, 'home', '.agents', 'skills'), 'review', 'SHARED_BODY');
  await harness.prepareWorkspace();
  const other = await harness.registerWorkspace(harness.other);
  const { id } = await harness.create(
    other.id,
    (await harness.createPreset([agentSkillsCapabilityId])).id,
  );
  expect((await submit(harness, id, '/review check changes'))[0].skillInstructions).toContain(
    'HOST_BODY',
  );
  await rm(hostReview, { recursive: true });
  await harness.restart();
  expect((await submit(harness, id, '/review check again'))[0].skillInstructions).toContain(
    'SHARED_BODY',
  );
});

test('uses the readable fallback during incomplete discovery and restores priority on recovery', async (context) => {
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  context.onTestFinished(() => warnings.mockRestore());
  const harness = await setupHarness(context);
  const project = join(harness.project, '.agents', 'skills');
  const blockedFile = join(project, 'review', 'SKILL.md');
  await mkdir(blockedFile, { recursive: true });
  await writeSkill(join(dirname(harness.databasePath), 'skills'), 'review', 'FALLBACK_BODY');
  const workspace = await harness.prepareWorkspace();
  const { id } = await harness.create(
    workspace.id,
    (await harness.createPreset([agentSkillsCapabilityId])).id,
  );

  const list = async () => {
    const response = await harness.fetch(`${origin}${AGENT_SKILLS_PATH}?sessionId=${id}`);
    return skillListingSchema.parse(await response.json());
  };

  expect(await list()).toMatchObject({ incomplete: true, items: [{ name: 'review' }] });
  const [fallback] = await submit(harness, id, '/review use the available instructions');
  expect(fallback.instructions).toContain('Skill discovery is incomplete');
  expect(fallback.skillInstructions).toContain('FALLBACK_BODY');

  await rmdir(blockedFile);
  await writeSkill(project, 'review', 'PROJECT_BODY');
  expect(await list()).toMatchObject({ incomplete: false, items: [{ name: 'review' }] });
  const [recovered] = await submit(harness, id, '/review use the current instructions');
  expect(recovered.instructions).not.toContain('Skill discovery is incomplete');
  expect(recovered.skillInstructions).toContain('PROJECT_BODY');
});

test('filters invocation policy after resolving names and leaves disabled presets untouched', async (context) => {
  const harness = await setupHarness(context);
  const host = join(dirname(harness.databasePath), 'skills');
  const project = join(harness.project, '.agents', 'skills');
  await writeSkill(host, 'manual', 'SHADOWED');
  await writeSkill(project, 'manual', 'USER_ONLY', 'disable-model-invocation: true\n');
  await writeSkill(host, 'auto', 'MODEL_ONLY', 'user-invocable: false\n');
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset([agentSkillsCapabilityId]);
  const session = await harness.create(workspace.id, preset.id);
  const response = await harness.fetch(`${origin}${AGENT_SKILLS_PATH}?sessionId=${session.id}`);
  const listing = skillListingSchema.parse(await response.json());
  expect(listing.incomplete).toBe(false);
  expect(listing.items.map(({ id: _id, ...skill }) => skill)).toEqual([
    { name: 'manual', description: 'Find manual', userOnly: true },
  ]);
  const manual = (await submit(harness, session.id, '/manual use this'))[0];
  expect(manual.instructions).toContain('- auto:');
  expect(manual.instructions).not.toContain('- manual:');
  expect(manual.skillInstructions).toContain('USER_ONLY');
  expect(manual.skillInstructions).not.toContain('SHADOWED');
  expect(
    (await submit(harness, session.id, '/auto not explicitly'))[0].skillInstructions,
  ).not.toContain('MODEL_ONLY');
  const disabled = await harness.create(workspace.id, (await harness.createPreset()).id);
  const disabledListing = await harness.fetch(
    `${origin}${AGENT_SKILLS_PATH}?sessionId=${disabled.id}`,
  );
  expect(skillListingSchema.parse(await disabledListing.json())).toEqual({
    items: [],
    incomplete: false,
  });
  const [request] = await submit(harness, disabled.id, '/manual ignored');
  expect(request.instructions).not.toContain('<available_skills>');
  expect(request.skillInstructions).toBe('');
  expect(request.toolNames).not.toContain('skill');
  const noSkills = await harness.create(
    (await harness.registerWorkspace(harness.other)).id,
    preset.id,
  );
  await rm(host, { recursive: true });
  const [empty] = await submit(harness, noSkills.id, '/manual is ordinary text here');
  expect(empty.instructions).not.toContain('<available_skills>');
  expect(empty.toolNames).toContain('skill');
});

test(
  'keeps other roots visible and resolves exact manual names beyond the browsing limit',
  { timeout: 45_000 },
  async (context) => {
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    context.onTestFinished(() => warnings.mockRestore());
    const harness = await setupHarness(context);
    const catalog = join(harness.project, '.agents', 'skills');
    for (let index = 0; index < 2000; index += 32) {
      await Promise.all(
        Array.from({ length: Math.min(32, 2000 - index) }, (_, offset) =>
          mkdir(join(catalog, `candidate-${String(index + offset).padStart(4, '0')}`), {
            recursive: true,
          }),
        ),
      );
    }
    await writeSkill(catalog, 'z-local', 'EXACT_BODY');
    await writeSkill(join(dirname(harness.databasePath), 'skills'), 'global-skill', 'GLOBAL_BODY');
    await writeSkill(join(dirname(harness.databasePath), 'skills'), 'z-local', 'GLOBAL_SHADOWED');
    const workspace = await harness.prepareWorkspace();
    const { id } = await harness.create(
      workspace.id,
      (await harness.createPreset([agentSkillsCapabilityId])).id,
    );
    const response = await harness.fetch(`${origin}${AGENT_SKILLS_PATH}?sessionId=${id}`);
    expect(skillListingSchema.parse(await response.json())).toMatchObject({
      incomplete: true,
      items: [{ name: 'global-skill' }, { name: 'z-local' }],
    });
    expect((await submit(harness, id, '/z-local Use this rule'))[0].skillInstructions).toContain(
      'EXACT_BODY',
    );
  },
);

test('resolves a command picked from the menu against the current catalog', async (context) => {
  const harness = await setupHarness(context);
  const project = await writeSkill(
    join(harness.project, '.agents', 'skills'),
    'review',
    'PROJECT_BODY',
  );
  const fallback = await writeSkill(
    join(dirname(harness.databasePath), 'skills'),
    'review',
    'FALLBACK_BODY',
  );
  const workspace = await harness.prepareWorkspace();
  const { id } = await harness.create(
    workspace.id,
    (await harness.createPreset([agentSkillsCapabilityId])).id,
  );
  const listing = await harness.fetch(`${origin}${AGENT_SKILLS_PATH}?sessionId=${id}`);
  const [{ name }] = skillListingSchema.parse(await listing.json()).items;
  const command = `/${name} review this change`;

  await rm(join(project, 'SKILL.md'));
  expect((await submit(harness, id, command))[0].skillInstructions).toContain('FALLBACK_BODY');

  await rm(join(fallback, 'SKILL.md'));
  const fresh = await harness.create(
    workspace.id,
    (await harness.createPreset([agentSkillsCapabilityId])).id,
  );
  expect((await submit(harness, fresh.id, command))[0].skillInstructions).toBe('');
});

test('loads distinct inline slash mentions once and ignores paths and fractions', async (context) => {
  const harness = await setupHarness(context);
  const directory = join(dirname(harness.databasePath), 'skills');
  await writeSkill(directory, 'review', 'REVIEW_BODY');
  await writeSkill(directory, 'verify', 'VERIFY_BODY');
  await writeSkill(directory, 'usr', 'PATH_BODY');
  await writeSkill(directory, '8', 'FRACTION_BODY');
  const workspace = await harness.prepareWorkspace();
  const { id } = await harness.create(
    workspace.id,
    (await harness.createPreset([agentSkillsCapabilityId])).id,
  );
  const [request] = await submit(
    harness,
    id,
    'Use /review and /verify then /review on /usr/bin for 5/8',
  );
  expect(request.skillInstructions.match(/REVIEW_BODY/g)).toHaveLength(1);
  expect(request.skillInstructions).toContain('VERIFY_BODY');
  expect(request.skillInstructions).not.toMatch(/PATH_BODY|FRACTION_BODY/);
});

test('reuses a complete discovery for the slash words in a submission', async (context) => {
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  context.onTestFinished(() => warnings.mockRestore());
  const harness = await setupHarness(context);
  const root = join(harness.project, '.agents', 'skills');
  await mkdir(dirname(root), { recursive: true });
  await linkDirectory(harness.other, root);
  await writeSkill(join(dirname(harness.databasePath), 'skills'), 'review', 'REVIEW_BODY');
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset([agentSkillsCapabilityId]);
  const { id } = await harness.create(workspace.id, preset.id);
  const response = await harness.fetch(`${origin}${AGENT_SKILLS_PATH}?sessionId=${id}`);
  expect(skillListingSchema.parse(await response.json())).toMatchObject({ incomplete: false });
  warnings.mockClear();

  const words = Array.from({ length: 50 }, (_, index) => `/unknown-${index}`).join(' ');
  const [request] = await submit(harness, id, `Use /review for ${words}`);
  expect(request.skillInstructions).toContain('REVIEW_BODY');
  const rootChecks = warnings.mock.calls.filter(([message]) =>
    String(message).includes('outside the project boundary'),
  );
  expect(rootChecks).toHaveLength(2);
});

test('rechecks a known slash skill after its catalog source disappears', async (context) => {
  const harness = await setupHarness(context);
  const projectRoot = join(harness.project, '.agents', 'skills');
  const projectFile = join(await writeSkill(projectRoot, 'review', 'PROJECT_BODY'), 'SKILL.md');
  await writeSkill(join(dirname(harness.databasePath), 'skills'), 'review', 'FALLBACK_BODY');
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset([agentSkillsCapabilityId]);
  const { id } = await harness.create(workspace.id, preset.id);
  const warnings = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
    if (String(message).includes(`uses ${projectFile}; shadowed`)) {
      unlinkSync(projectFile);
    }
  });
  context.onTestFinished(() => warnings.mockRestore());

  const [request] = await submit(harness, id, '/review this change');
  expect(request.skillInstructions).toContain('FALLBACK_BODY');
});

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0).for([
  { policy: 'allows', flags: '', invocable: true },
  { policy: 'denies', flags: 'user-invocable: false\n', invocable: false },
])('honors a search-only project skill that $policy slash invocation', async (entry, context) => {
  const harness = await setupHarness(context);
  const projectRoot = join(harness.project, '.agents', 'skills');
  await writeSkill(projectRoot, 'review', 'PROJECT_BODY', entry.flags);
  await writeSkill(join(dirname(harness.databasePath), 'skills'), 'review', 'HOST_BODY');
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset([agentSkillsCapabilityId]);
  const { id } = await harness.create(workspace.id, preset.id);
  await chmod(projectRoot, 0o111);
  try {
    const response = await harness.fetch(`${origin}${AGENT_SKILLS_PATH}?sessionId=${id}`);
    expect(skillListingSchema.parse(await response.json())).toMatchObject({ incomplete: true });
    const [request] = await submit(harness, id, '/review this change');
    expect(request.skillInstructions).not.toContain('HOST_BODY');
    expect(request.skillInstructions.includes('PROJECT_BODY')).toBe(entry.invocable);
  } finally {
    await chmod(projectRoot, 0o700);
  }
});

test('reports mismatched metadata and keeps discovery inside the approved roots', async (context) => {
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  context.onTestFinished(() => warnings.mockRestore());
  const harness = await setupHarness(context);
  const catalog = join(harness.project, '.agents', 'skills');
  const invalid = await writeSkill(catalog, 'mismatched', 'INVALID_BODY');
  await writeFile(
    join(invalid, 'SKILL.md'),
    '---\nname: different\ndescription: Mismatch\n---\n\nINVALID_BODY',
  );
  await writeSkill(catalog, 'dot.name', 'NONSTANDARD_NAME');
  const other = await writeSkill(join(harness.other, 'skills'), 'linked', 'BOUNDARY_BODY');
  await linkDirectory(other, join(catalog, 'linked'));
  const workspace = await harness.prepareWorkspace();
  const { id } = await harness.create(
    workspace.id,
    (await harness.createPreset([agentSkillsCapabilityId])).id,
  );
  const response = await harness.fetch(`${origin}${AGENT_SKILLS_PATH}?sessionId=${id}`);
  expect(skillListingSchema.parse(await response.json())).toEqual({ items: [], incomplete: true });
  for (const name of ['mismatched', 'different', 'dot.name', 'linked']) {
    expect((await submit(harness, id, `/${name}`))[0].skillInstructions).toBe('');
  }
});

test('does not apply an interrupted skill invocation on the next request', async (context) => {
  const started = deferred();
  const release = deferred();
  const harness = await setupHarness(context, [], async ({ name }) => {
    if (name === 'skill') {
      started.resolve();
      await release.promise;
    }
  });
  await writeSkill(join(dirname(harness.databasePath), 'skills'), 'review', 'ABORTED_SKILL_BODY');
  const workspace = await harness.prepareWorkspace();
  const { id } = await harness.create(
    workspace.id,
    (await harness.createPreset([agentSkillsCapabilityId])).id,
  );
  const client = harness.sdk(id);
  const receipt = await client.send({
    message: { kind: 'user', body: JSON.stringify({ tool: 'skill', name: 'review' }) },
  });
  const settled = client.wait(receipt, { signal: AbortSignal.timeout(5_000) });
  const failure = settled.then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    await Promise.race([started.promise, failure]);
    expect((await client.abort()).aborted).toBe(true);
  } finally {
    release.resolve();
  }
  expect(await failure).toMatchObject({ failure: 'aborted' });
  const [next] = await submit(harness, id, 'Continue without that skill');
  expect(next.skillInstructions).toBe('');
  const [interrupted] = await readTrajectory(
    harness.fetch(`${origin}/api/conversations/${id}/trajectory`),
  );
  expect(interrupted.status).toBe('interrupted');
  expect(interrupted.records.some((record) => record.kind === 'context' && record.skill)).toBe(
    false,
  );
});

test.for([
  { boundary: 'before the provider call', startProvider: false, restart: false },
  { boundary: 'after the provider call', startProvider: true, restart: false },
  { boundary: 'before the provider call with Host restart', startProvider: false, restart: true },
] as const)(
  'excludes a manual skill cancelled $boundary',
  async ({ startProvider, restart }, context) => {
    const reached = deferred();
    const release = deferred();
    let providerSignal: AbortSignal | undefined;
    const harness = await setupHarness(context, [], undefined, (observed) => {
      const provider = fixtureProvider(observed);
      let first = startProvider;
      return {
        ...provider,
        streamSimple(...args) {
          const response = provider.streamSimple(...args);
          if (!first) {
            return response;
          }
          first = false;
          providerSignal = args[2]?.signal;
          const pending = createAssistantMessageEventStream();
          reached.resolve();
          void release.promise.then(async () => {
            const error = await response.result();
            pending.push({
              type: 'error',
              reason: 'aborted',
              error: { ...error, content: [], stopReason: 'aborted' },
            });
          });
          return pending;
        },
      };
    });
    const skills = join(dirname(harness.databasePath), 'skills');
    await writeSkill(skills, 'review', 'ABANDONED_REVIEW_BODY', 'disable-model-invocation: true\n');
    const workspace = await harness.prepareWorkspace();
    const preset = await harness.createPreset([agentSkillsCapabilityId]);
    const { id } = await harness.create(workspace.id, preset.id);
    const client = harness.sdk(id);
    const dispose = startProvider
      ? undefined
      : instrument({
          observe() {},
          dispose() {},
          async interceptor(operation, _context, next) {
            if (operation.type !== 'model') {
              return next();
            }
            reached.resolve();
            await release.promise;
            throw new DOMException('Cancelled fixture request', 'AbortError');
          },
        });

    try {
      const receipt = await client.send({ message: { kind: 'user', body: '/review review this' } });
      const settled = client.wait(receipt, { signal: context.signal }).then(
        () => undefined,
        (error: unknown) => error,
      );
      await Promise.race([reached.promise, settled]);
      expect(harness.observed).toHaveLength(startProvider ? 1 : 0);
      try {
        expect((await client.abort()).aborted).toBe(true);
      } finally {
        release.resolve();
      }
      expect({ failure: await settled, providerAborted: providerSignal?.aborted }).toMatchObject(
        startProvider ? { providerAborted: true } : { failure: { failure: 'aborted' } },
      );
    } finally {
      release.resolve();
      await dispose?.();
    }

    if (restart) {
      await harness.restart();
    }
    const [followUp] = await submit(harness, id, 'Continue with a different task');
    expect(followUp.skillInstructions).toBe('');
    await writeSkill(skills, 'review', 'CURRENT_REVIEW_BODY', 'disable-model-invocation: true\n');
    const [retry] = await submit(harness, id, '/review retry the review');
    expect(retry.skillInstructions.match(/CURRENT_REVIEW_BODY/g)).toHaveLength(1);
    expect(retry.skillInstructions).not.toContain('ABANDONED_REVIEW_BODY');
  },
);

async function setupJoinedSkill(context: TestContext, marker: string, beforeSignal?: () => void) {
  const admitted = deferred<DispatchReceipt>();
  const initialMessage = '{"path":"README.md"}';
  const fixture = {
    id: 'fixture-joined-skill',
    name: 'Joined skill fixture',
    description: 'Dispatches a scoped skill after a file read.',
  };
  const harness = await setupHarness(context, [
    fileReadCapability,
    {
      service: 'fixtureJoinedSkill',
      plugin: {
        id: fixture.id,
        requires: [],
        provides: ['fixtureJoinedSkill'],
        setup(context) {
          context.provide('fixtureJoinedSkill', {
            metadata: fixture,
            useContext() {
              const dispatch = useDispatchMessage();
              const delivery = useDelivery();

              async function dispatchSignal() {
                admitted.resolve(
                  await dispatch({
                    kind: 'signal',
                    type: 'skill-invocation',
                    tagName: 'system-reminder',
                    body: marker,
                    attributes: { contextLifetime: 'response' },
                  }),
                );
              }

              useAgentStart(async () => {
                if (delivery.kind === 'signal' && delivery.type === 'skill-invocation') {
                  beforeSignal?.();
                }
                if (beforeSignal && delivery.kind === 'user' && delivery.body === initialMessage) {
                  await dispatchSignal();
                }
              });
              return beforeSignal ? {} : { onFiles: dispatchSignal };
            },
          });
        },
      },
    },
  ]);
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset(['file.read', fixture.id]);
  const { id } = await harness.create(workspace.id, preset.id);
  const client = harness.sdk(id);
  const receipt = await client.send({ message: { kind: 'user', body: initialMessage } });
  return { harness, id, client, receipt, admitted: admitted.promise };
}

test('keeps a joined skill on the receiving response, including before the owner was stored', async (context) => {
  const marker = 'LEGACY_JOINED_SKILL_BODY';
  const { harness, id, client, receipt: host } = await setupJoinedSkill(context, marker);
  await client.wait(host, { signal: context.signal });
  expect(harness.observed.at(-1)?.skillInstructions).toContain(marker);

  await harness.getRuntime().dispose();
  {
    using database = new DatabaseSync(harness.databasePath);
    const rows = database
      .prepare(`
      SELECT batch.path, batch.seq, '$[' || item.key || '].attributes.contextSubmissionId' AS field
      FROM flue_conversation_stream_batches AS batch, json_each(batch.data) AS item
      WHERE json_extract(item.value, '$.content') = ?
        AND json_extract(item.value, '$.attributes.contextSubmissionId') = ?
        AND json_extract(item.value, '$.submissionId') != ?
    `)
      .all(marker, host.submissionId, host.submissionId);
    expect(rows).toHaveLength(1);
    const [{ path, seq, field }] = rows;
    database
      .prepare(`
      UPDATE flue_conversation_stream_batches SET data = json_remove(data, ?)
      WHERE path = ? AND seq = ?
    `)
      .run(field, path, seq);
  }
  await harness.restart();
  const [request] = await submit(harness, id, 'Follow up on the read');
  expect(request.skillInstructions).toContain(marker);
});

test('retains a scoped skill when a failed join runs the delivery on its own', async (context) => {
  const marker = 'REQUEUED_SKILL_BODY';
  let failFirst = true;
  const { harness, id, client, receipt, admitted } = await setupJoinedSkill(context, marker, () => {
    if (failFirst) {
      failFirst = false;
      throw new Error('Join fixture rejected its first start');
    }
  });
  await expect(client.wait(receipt, { signal: context.signal })).rejects.toMatchObject({
    targetId: receipt.submissionId,
    failure: 'failed',
  });
  const dispatch = await admitted;
  await client.wait({ ...receipt, ...dispatch }, { signal: context.signal });
  expect(harness.observed.at(-1)?.skillInstructions).toContain(marker);
  const [request] = await submit(harness, id, 'Follow up on the standalone delivery');
  expect(request.skillInstructions).toContain(marker);
});

test('sends a long skill body in full and records it in Trajectory', async (context) => {
  const harness = await setupHarness(context);
  const body = 'START_OF_SKILL ' + 'a'.repeat(24_000) + ' END_OF_SKILL';
  await writeSkill(join(dirname(harness.databasePath), 'skills'), 'long-skill', body);
  const workspace = await harness.prepareWorkspace();
  const { id } = await harness.create(
    workspace.id,
    (await harness.createPreset([agentSkillsCapabilityId])).id,
  );
  const requests = await submit(harness, id, '/long-skill Try it');
  expect(requests[0]?.skillInstructions).toContain(body);
  const path = `${origin}/api/conversations/${id}/trajectory`;
  const turn = (await readTrajectory(harness.fetch(path))).at(0);
  const model = turn?.records.find((record) => record.kind === 'assistant');
  if (!turn || !model) {
    throw new Error('Missing model request.');
  }
  const response = await harness.fetch(`${path}/${turn.id}/${model.id}`);
  const input = trajectoryModelInputResponseSchema.parse(await response.json());
  expect(JSON.stringify(input.messages)).toContain(body);
});

test('records a skill read failure without sending a model request', async (context) => {
  const harness = await setupHarness(context);
  await writeSkill(
    join(dirname(harness.databasePath), 'skills'),
    'oversized',
    'LARGE_SKILL ' + 'a'.repeat(1024 * 1024),
  );
  const workspace = await harness.prepareWorkspace();
  const { id } = await harness.create(
    workspace.id,
    (await harness.createPreset([agentSkillsCapabilityId])).id,
  );
  const client = harness.sdk(id);
  const receipt = await client.send({
    message: { kind: 'user', body: '/oversized Try it' },
  });
  await expect(client.wait(receipt, { signal: AbortSignal.timeout(5_000) })).rejects.toMatchObject({
    failure: 'failed',
  });
  expect(harness.observed).toHaveLength(0);
  const [turn] = await readTrajectory(
    harness.fetch(`${origin}/api/conversations/${id}/trajectory`),
  );
  expect(turn.status).toBe('failed');
  const error = 'Skill oversized exceeds the 1 MiB source file limit.';
  expect(turn.error).toBe(error);
  expect((await client.history()).settlements.at(-1)?.error).toMatchObject({ message: error });
});

test(
  'replaces the model catalog between submissions and enforces its budget with 1,000 local skills',
  { timeout: 45_000 },
  async (context) => {
    const harness = await setupHarness(context);
    const host = join(dirname(harness.databasePath), 'skills');
    await mkdir(host);
    for (let start = 0; start < 1000; start += 40) {
      await Promise.all(
        Array.from({ length: 40 }, (_, offset) =>
          writeSkill(host, `rule-${String(start + offset).padStart(4, '0')}`, 'BODY_ONLY'),
        ),
      );
    }
    const workspace = await harness.prepareWorkspace();
    const session = await harness.create(
      workspace.id,
      (await harness.createPreset([agentSkillsCapabilityId])).id,
    );
    const [first] = await submit(harness, session.id, '/rule-0999 direct access');
    const catalog =
      /<available_skills>[\s\S]+?<\/available_skills>/.exec(first.instructions)?.[0] ?? '';
    expect(catalog).toContain('850 skills omitted');
    expect(Buffer.byteLength(catalog)).toBeLessThanOrEqual(2560);
    expect(catalog).not.toContain('rule-0999');
    expect(first.skillInstructions).toContain('BODY_ONLY');
    for (const name of ['a-first', 'b-second', 'c-third']) {
      await writeSkill(host, name, 'NEW_BODY');
      const [next] = await submit(harness, session.id, 'Refresh');
      expect(next.instructions.match(/<available_skills>/g)).toHaveLength(1);
      expect(next.instructions).toContain(name);
    }
  },
);
