import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  AGENT_SKILLS_PATH,
  agentSkillsCapabilityId,
  productRoutes,
  skillSummarySchema,
  trajectoryModelInputResponseSchema,
} from '@workspace/protocol/host';
import { expect, test } from 'vitest';
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

test('loads project overrides, then Host and shared global skills in other workspaces', async (context) => {
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
  await linkDirectory(outside, join(nested, 'linked'));

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

  const other = await harness.registerWorkspace(harness.other);
  const second = await harness.create(other.id, preset.id);
  expect(
    (await submit(harness, second.id, '/review check changes'))[0].skillInstructions,
  ).toContain('HOST_BODY');
  await rm(hostReview, { recursive: true });
  await harness.restart();
  expect((await submit(harness, second.id, '/review check again'))[0].skillInstructions).toContain(
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
  expect(skillSummarySchema.array().parse(await response.json())).toEqual([
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
