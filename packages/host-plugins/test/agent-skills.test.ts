import { mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
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
