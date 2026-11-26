import { unlinkSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  AGENT_SKILLS_PATH,
  agentSkillsCapabilityId,
  productRoutes,
  skillListingSchema,
  trajectoryModelInputResponseSchema,
} from '@workspace/protocol/host';
import { expect, test, vi } from 'vitest';
import { linkDirectory, origin, readTrajectory, setupHarness } from './fixtures/harness.js';

async function writeSkill(root: string, name: string, marker: string, flags = '') {
  const folder = join(root, name);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Find ${name}\n${flags}---\n\n${marker}\n`,
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('loads, reuses, and refreshes project skill overrides', async (context) => {
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
  await writeSkill(project, 'review', 'PROJECT_BODY');
  const nestedReview = await writeSkill(nested, 'review', 'NESTED_BODY');
  const outside = await writeSkill(join(harness.other, 'other-skills'), 'linked', 'OUTSIDE_BODY');
  const linked = join(nested, 'linked');
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
  expect(automatic.at(-1)?.skillInstructions).toContain('NESTED_BODY');
  expect(automatic.at(-1)?.skillInstructions).not.toMatch(/HOST_BODY|SHARED_BODY|PROJECT_BODY/);
  expect(warnings).toHaveBeenCalledWith(
    expect.stringContaining(
      `uses ${join(nestedReview, 'SKILL.md')}; shadowed ${join(hostReview, 'SKILL.md')}`,
    ),
  );
  expect(warnings).toHaveBeenCalledWith(
    expect.stringContaining(`${linked}: outside the project boundary.`),
  );
  const [turn] = await readTrajectory(
    harness.fetch(`${origin}/api/conversations/${session.id}/trajectory`),
  );
  const applied = turn.records.find(
    (record) => record.kind === 'context' && record.skill?.name === 'review',
  );
  if (applied?.kind !== 'context' || !applied.modelRequestId) {
    throw new Error('Expected a model request for the loaded skill.');
  }
  expect(applied.body).toContain('NESTED_BODY');
  const inputPath = productRoutes.modelInput.path
    .replace(':id', session.id)
    .replace(':submissionId', turn.id)
    .replace(':modelId', applied.modelRequestId);
  const inputResponse = await harness.fetch(origin + inputPath);
  expect(inputResponse.ok).toBe(true);
  const input = trajectoryModelInputResponseSchema.parse(await inputResponse.json());
  expect(JSON.stringify(input)).toContain('NESTED_BODY');
  const repeated = await submit(
    harness,
    session.id,
    JSON.stringify({ tool: 'skill', name: 'review' }),
  );
  expect(repeated.at(-1)?.skillInstructions.match(/NESTED_BODY/g)).toHaveLength(1);
  await writeSkill(nested, 'review', 'EDITED_BODY');
  const edited = (await submit(harness, session.id, '/review check changes'))[0];
  expect(edited.skillInstructions.match(/EDITED_BODY/g)).toHaveLength(1);
  await rm(nestedReview, { recursive: true });
  const [parent] = await submit(harness, session.id, '/review now use parent');
  expect(parent.skillInstructions.match(/PROJECT_BODY/g)).toHaveLength(1);
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
  expect(empty.toolNames).not.toContain('skill');
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

test('rejects an explicit selection when only a same-named fallback remains', async (context) => {
  const harness = await setupHarness(context);
  const project = await writeSkill(
    join(harness.project, '.agents', 'skills'),
    'review',
    'PROJECT_BODY',
  );
  await writeSkill(join(dirname(harness.databasePath), 'skills'), 'review', 'FALLBACK_BODY');
  const workspace = await harness.prepareWorkspace();
  const { id } = await harness.create(
    workspace.id,
    (await harness.createPreset([agentSkillsCapabilityId])).id,
  );
  const response = await harness.fetch(`${origin}${AGENT_SKILLS_PATH}?sessionId=${id}`);
  const [{ id: skillId, name }] = skillListingSchema.parse(await response.json()).items;
  await rm(join(project, 'SKILL.md'));
  const rejected = await harness.post(`/api/conversations/${id}`, {
    kind: 'user',
    body: '/review Use the project skill',
    selectedSkill: { id: skillId, name },
  });
  expect(rejected.status).toBe(409);
  expect(harness.observed).toHaveLength(0);
  expect(
    (await submit(harness, id, '/review Use the current skill'))[0].skillInstructions,
  ).toContain('FALLBACK_BODY');
});

test('preserves the selected source after the request is accepted', async (context) => {
  const harness = await setupHarness(context);
  const project = await writeSkill(
    join(harness.project, '.agents', 'skills'),
    'review',
    'PROJECT_BODY',
  );
  await writeSkill(join(dirname(harness.databasePath), 'skills'), 'review', 'FALLBACK_BODY');
  const workspace = await harness.prepareWorkspace();
  const { id } = await harness.create(
    workspace.id,
    (await harness.createPreset([agentSkillsCapabilityId])).id,
  );
  const response = await harness.fetch(`${origin}${AGENT_SKILLS_PATH}?sessionId=${id}`);
  const [{ id: skillId, name }] = skillListingSchema.parse(await response.json()).items;
  const sessions = harness.getRuntime().get('workspaceToolSessions');
  const resolveWorkspace = sessions.workspaceRootForSession.bind(sessions);
  const removeSelected = vi
    .spyOn(sessions, 'workspaceRootForSession')
    .mockImplementationOnce((sessionId) => {
      unlinkSync(join(project, 'SKILL.md'));
      return resolveWorkspace(sessionId);
    });
  context.onTestFinished(() => removeSelected.mockRestore());
  const client = harness.sdk(id);
  const message = {
    kind: 'user' as const,
    body: '/review Use the project skill',
    selectedSkill: { id: skillId, name },
  };
  const receipt = await client.send({ message });
  await expect(client.wait(receipt, { signal: AbortSignal.timeout(5000) })).rejects.toMatchObject({
    failure: 'failed',
  });
  expect(harness.observed).toHaveLength(0);
  const [turn] = await readTrajectory(
    harness.fetch(`${origin}/api/conversations/${id}/trajectory`),
  );
  expect(turn).toMatchObject({
    status: 'failed',
    error: 'The selected skill is no longer available.',
  });
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

test.for(['user', 'model'] as const)(
  'does not append an identical skill already in model input when called by the %s',
  async (actor, context) => {
    const harness = await setupHarness(context);
    const skills = join(dirname(harness.databasePath), 'skills');
    await writeSkill(skills, 'first', 'FIRST_SKILL ' + 'a'.repeat(17_500));
    await writeSkill(skills, 'second', 'SECOND_SKILL ' + 'b'.repeat(17_500));
    const workspace = await harness.prepareWorkspace();
    const { id } = await harness.create(
      workspace.id,
      (await harness.createPreset([agentSkillsCapabilityId])).id,
    );
    await submit(harness, id, '/first First task');
    await submit(harness, id, '/second Second task');
    const requests = await submit(
      harness,
      id,
      actor === 'user' ? '/first Again' : JSON.stringify({ tool: 'skill', name: 'first' }),
    );
    expect(requests.at(-1)?.skillInstructions.match(/FIRST_SKILL/g)).toHaveLength(1);
    const path = `${origin}/api/conversations/${id}/trajectory`;
    const turn = (await readTrajectory(harness.fetch(path))).at(-1);
    const model = turn?.records.findLast((record) => record.kind === 'assistant');
    if (!turn || !model) {
      throw new Error('Missing final model request.');
    }
    const response = await harness.fetch(`${path}/${turn.id}/${model.id}`);
    const input = trajectoryModelInputResponseSchema.parse(await response.json());
    expect(JSON.stringify(input.messages).match(/FIRST_SKILL/g)).toHaveLength(1);
    expect(turn.records.some((record) => record.kind === 'context')).toBe(false);
  },
);

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

test('records a selected skill source failure without sending a model request', async (context) => {
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
  const listing = await harness.fetch(`${origin}${AGENT_SKILLS_PATH}?sessionId=${id}`);
  const [selectedSkill] = skillListingSchema.parse(await listing.json()).items;
  const message = {
    kind: 'user' as const,
    body: '/oversized Try it',
    selectedSkill: { id: selectedSkill.id, name: selectedSkill.name },
  };
  const receipt = await client.send({ message });
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
