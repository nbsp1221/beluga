import { readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { skillNameSchema } from '@workspace/protocol/host';
import * as v from 'valibot';
import { FileReadError, read } from '../filesystem/read.js';
import { loadPi } from '../pi/tool.js';
import { resolveProjectRoot } from '../workspace/project-root.js';

const maxCandidates = 2000;
const maxHeaderBytes = 16 * 1024;
const maxSourceBytes = 1024 * 1024;
const frontmatterEnd = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const metadataSchema = v.object({
  'name': v.string(),
  'description': v.pipe(v.string(), v.trim(), v.nonEmpty()),
  'disable-model-invocation': v.optional(v.boolean()),
  'user-invocable': v.optional(v.boolean()),
});

export interface SkillSource {
  name: string;
  description: string;
  directory: string;
  path: string;
  root: string;
  scope: 'project' | 'global';
  modelInvocable: boolean;
  userInvocable: boolean;
}

function within(root: string, target: string) {
  const path = relative(root, target);
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}

function missing(error: unknown) {
  return (
    (error instanceof FileReadError && error.code === 'NOT_FOUND') ||
    (error instanceof Error &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR'].includes(String(error.code)))
  );
}

async function readSkill(path: string, header: boolean, signal?: AbortSignal) {
  const limit = header ? maxHeaderBytes : maxSourceBytes;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let count = 0;
  let text = '';
  for await (const chunk of read({ absolutePath: path }, { signal })) {
    const part = chunk.subarray(0, limit - count);
    text += decoder.decode(part, { stream: true });
    count += part.byteLength;
    const frontmatter = header && frontmatterEnd.exec(text)?.[0];
    if (frontmatter && frontmatter.endsWith('\n')) {
      return frontmatter;
    }
    if (part.byteLength < chunk.byteLength) {
      return undefined;
    }
  }
  return text + decoder.decode();
}

function parseSkill(text: string | undefined, name: string) {
  if (!text || !frontmatterEnd.test(text)) {
    return;
  }
  const { frontmatter, body } = loadPi().parseFrontmatter(text);
  const parsed = v.safeParse(metadataSchema, frontmatter);
  if (
    !parsed.success ||
    parsed.output.name !== name ||
    Array.from(parsed.output.description).length > 1024
  ) {
    return;
  }
  return { metadata: parsed.output, body };
}

async function inspectSkill(
  root: string,
  name: string,
  scope: SkillSource['scope'],
  boundary: string,
  signal?: AbortSignal,
): Promise<SkillSource | undefined> {
  try {
    signal?.throwIfAborted();
    const directory = await realpath(join(root, name));
    const path = await realpath(join(directory, 'SKILL.md'));
    if (!within(boundary, directory) || !within(boundary, path)) {
      return;
    }
    const parsed = parseSkill(await readSkill(path, true, signal), name);
    if (!parsed) {
      console.warn(`Skipped invalid skill metadata for ${name}.`);
      return;
    }
    return {
      name,
      description: parsed.metadata.description,
      directory,
      path,
      root,
      scope,
      modelInvocable: parsed.metadata['disable-model-invocation'] !== true,
      userInvocable: parsed.metadata['user-invocable'] !== false,
    };
  } catch (error) {
    signal?.throwIfAborted();
    if (!missing(error)) {
      console.warn(`Could not read skill ${name}.`);
    }
  }
}

export async function discoverSkills(
  cwd: string | undefined,
  globals: readonly string[],
  signal?: AbortSignal,
) {
  const roots: { path: string; boundary?: string; scope: SkillSource['scope'] }[] = [];
  if (cwd) {
    try {
      const root = await resolveProjectRoot({ realpath, stat }, cwd, undefined, signal);
      for (let path = cwd; ; path = dirname(path)) {
        roots.push({ path: join(path, '.agents', 'skills'), boundary: root, scope: 'project' });
        if (path === root) {
          break;
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      console.warn(
        'Could not inspect the project skill roots.',
        error instanceof Error && error.name,
      );
    }
  }
  roots.push(...globals.map((path) => ({ path, scope: 'global' as const })));

  const skills = new Map<string, SkillSource>();
  let candidates = 0;
  for (const { path: root, boundary, scope } of roots) {
    signal?.throwIfAborted();
    try {
      const canonical = await realpath(root);
      if (boundary && !within(boundary, canonical)) {
        continue;
      }
      const entries = (await readdir(canonical, { withFileTypes: true }))
        .filter(
          (entry) =>
            (entry.isDirectory() || entry.isSymbolicLink()) &&
            skillNameSchema.safeParse(entry.name).success,
        )
        .sort((a, b) => (a.name < b.name ? -1 : Number(a.name > b.name)));
      const selected = entries.slice(0, maxCandidates - candidates);
      const batchSize = 16;
      for (let offset = 0; offset < selected.length; offset += batchSize) {
        const batch = await Promise.all(
          selected
            .slice(offset, offset + batchSize)
            .map(({ name }) => inspectSkill(canonical, name, scope, boundary ?? canonical, signal)),
        );
        for (const skill of batch) {
          if (!skill) {
            continue;
          }
          if (skills.has(skill.name)) {
            console.warn(`A higher priority definition shadows skill ${skill.name}.`);
          } else {
            skills.set(skill.name, skill);
          }
        }
      }
      candidates += selected.length;
      if (entries.length > selected.length) {
        console.warn(`Stopped scanning after ${maxCandidates} skill candidates.`);
        break;
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (!missing(error)) {
        console.warn(`Could not scan a ${scope} skill directory.`);
      }
    }
  }
  return [...skills.values()];
}

export async function loadSkill(
  source: SkillSource,
  actor: 'model' | 'user',
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const directory = await realpath(join(source.root, source.name)).catch(() => undefined);
  const path = directory && (await realpath(join(directory, 'SKILL.md')).catch(() => undefined));
  if (directory !== source.directory || path !== source.path) {
    throw new Error(`Skill ${source.name} is no longer available.`);
  }
  const text = await readSkill(path, false, signal).catch(() => undefined);
  signal?.throwIfAborted();
  const parsed = parseSkill(text, source.name);
  if (!parsed?.body) {
    throw new Error(`Could not load skill ${source.name}. Check SKILL.md.`);
  }
  if (
    actor === 'model'
      ? parsed.metadata['disable-model-invocation'] === true
      : parsed.metadata['user-invocable'] === false
  ) {
    throw new Error(`Skill ${source.name} does not allow this type of invocation.`);
  }
  return parsed.body;
}
