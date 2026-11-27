import { createHash } from 'node:crypto';
import { readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { FlueError } from '@flue/runtime';
import { skillLoadFailureType, skillNameSchema } from '@workspace/protocol/host';
import * as v from 'valibot';
import { FileReadError, read } from '../filesystem/read.js';
import { loadPi } from '../pi/tool.js';
import { resolveProjectRoot } from '../workspace/project-root.js';

const maxCandidates = 2000;
const maxCachedHeaders = maxCandidates * 2;
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

type SkillMetadata = v.InferOutput<typeof metadataSchema>;

type SkillHeader = (
  path: string,
  name: string,
  signal?: AbortSignal,
) => Promise<SkillMetadata | undefined>;

interface CachedHeader {
  revision: string;
  parsed: ReturnType<typeof parseSkill>;
}

export function selectionId(source: SkillSource) {
  return createHash('sha256')
    .update(JSON.stringify([source.scope, source.root, source.name, source.path]))
    .digest('hex');
}

export class SkillLoadError extends FlueError {
  constructor(message: string) {
    super({ type: skillLoadFailureType, message, details: '', dev: '' });
  }
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
  // A byte beyond the limit distinguishes a complete file from a truncated read.
  for await (const chunk of read({ absolutePath: path }, { signal, end: limit })) {
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

function parseSkill(text: string | undefined) {
  if (!text || !frontmatterEnd.test(text)) {
    return;
  }
  const { frontmatter, body } = loadPi().parseFrontmatter(text);
  const parsed = v.safeParse(metadataSchema, frontmatter);
  if (!parsed.success || Array.from(parsed.output.description).length > 1024) {
    return;
  }
  return { metadata: parsed.output, body };
}

async function inspectSkill(
  root: string,
  name: string,
  scope: SkillSource['scope'],
  boundary: string,
  header: SkillHeader,
  signal?: AbortSignal,
): Promise<SkillSource | 'incomplete' | undefined> {
  try {
    signal?.throwIfAborted();
    const entry = join(root, name);
    const directory = await realpath(entry);
    if (!within(boundary, directory)) {
      console.warn(`Skipped skill ${name} at ${entry}: outside the ${scope} boundary.`);
      return;
    }
    const path = await realpath(join(directory, 'SKILL.md'));
    if (!within(boundary, path)) {
      console.warn(
        `Skipped skill ${name} at ${join(entry, 'SKILL.md')}: outside the ${scope} boundary.`,
      );
      return;
    }
    const metadata = await header(path, name, signal);
    if (!metadata) {
      console.warn(`Skipped invalid skill metadata at ${path}.`);
      return 'incomplete';
    }
    return {
      name,
      description: metadata.description,
      directory,
      path,
      root,
      scope,
      modelInvocable: metadata['disable-model-invocation'] !== true,
      userInvocable: metadata['user-invocable'] !== false,
    };
  } catch (error) {
    signal?.throwIfAborted();
    if (!missing(error)) {
      console.warn(`Could not read skill ${name} at ${join(root, name, 'SKILL.md')}.`);
      return 'incomplete';
    }
  }
}

export function createSkillDiscovery(globals: readonly string[]) {
  const headers = new Map<string, CachedHeader>();

  async function header(path: string, name: string, signal?: AbortSignal) {
    const details = await stat(path, { bigint: true });
    const revision = `${details.dev}:${details.ino}:${details.size}:${details.mtimeNs}:${details.ctimeNs}`;
    const cached = headers.get(path);
    if (cached?.revision === revision) {
      return cached.parsed?.metadata.name === name ? cached.parsed.metadata : undefined;
    }
    // Cache the parsed file by its identity. Validate the directory name on lookup.
    const parsed = parseSkill(await readSkill(path, true, signal));
    if (!headers.has(path) && headers.size >= maxCachedHeaders) {
      const oldest = headers.keys().next();
      if (!oldest.done) {
        headers.delete(oldest.value);
      }
    }
    headers.set(path, { revision, parsed });
    return parsed?.metadata.name === name ? parsed.metadata : undefined;
  }

  return (cwd: string | undefined, signal?: AbortSignal, onlyName?: string) =>
    discoverSkills(cwd, globals, header, signal, onlyName);
}

async function discoverSkills(
  cwd: string | undefined,
  globals: readonly string[],
  header: SkillHeader,
  signal?: AbortSignal,
  onlyName?: string,
) {
  let incomplete = false;
  const roots: { path: string; boundary?: string; scope: SkillSource['scope'] }[] = [];
  if (cwd) {
    try {
      const root = await resolveProjectRoot({ realpath, stat }, cwd, undefined, signal);
      roots.push({ path: join(root, '.agents', 'skills'), boundary: root, scope: 'project' });
    } catch (error) {
      signal?.throwIfAborted();
      console.warn(
        'Could not inspect the project skill roots.',
        error instanceof Error && error.name,
      );
      incomplete = true;
    }
  }
  roots.push(...globals.map((path) => ({ path, scope: 'global' as const })));

  const skills = new Map<string, SkillSource>();
  const overflowed: {
    root: string;
    boundary: string;
    scope: SkillSource['scope'];
    names: Set<string>;
  }[] = [];
  for (const { path: root, boundary, scope } of roots) {
    signal?.throwIfAborted();
    try {
      const canonical = await realpath(root);
      if (boundary && !within(boundary, canonical)) {
        console.warn(`Skipped skill directory ${root}: outside the ${scope} boundary.`);
        continue;
      }
      if (onlyName !== undefined) {
        if (!skillNameSchema.safeParse(onlyName).success) {
          break;
        }
        const skill = await inspectSkill(
          canonical,
          onlyName,
          scope,
          boundary ?? canonical,
          header,
          signal,
        );
        if (skill === 'incomplete') {
          incomplete = true;
        } else if (skill) {
          return { sources: [skill], incomplete };
        }
        continue;
      }
      const entries = (await readdir(canonical, { withFileTypes: true }))
        .filter(
          (entry) =>
            (entry.isDirectory() || entry.isSymbolicLink()) &&
            skillNameSchema.safeParse(entry.name).success,
        )
        .sort((a, b) => (a.name < b.name ? -1 : Number(a.name > b.name)));
      const selected = entries.slice(0, maxCandidates);
      if (entries.length > selected.length) {
        incomplete = true;
        console.warn(`Stopped scanning ${root} after ${maxCandidates} skill candidates.`);
      }
      const batchSize = 16;
      for (let offset = 0; offset < selected.length; offset += batchSize) {
        const batch = await Promise.all(
          selected
            .slice(offset, offset + batchSize)
            .map(({ name }) =>
              inspectSkill(canonical, name, scope, boundary ?? canonical, header, signal),
            ),
        );
        for (const skill of batch) {
          if (skill === 'incomplete') {
            incomplete = true;
            continue;
          }
          if (!skill) {
            continue;
          }
          let winner = skills.get(skill.name);
          if (!winner) {
            // An omitted name can still shadow the same name in a later root.
            for (const previous of overflowed) {
              if (!previous.names.has(skill.name)) {
                continue;
              }
              const earlier = await inspectSkill(
                previous.root,
                skill.name,
                previous.scope,
                previous.boundary,
                header,
                signal,
              );
              if (earlier && earlier !== 'incomplete') {
                skills.set(earlier.name, earlier);
                winner = earlier;
                break;
              }
            }
          }
          if (winner) {
            console.warn(`Skill ${skill.name} uses ${winner.path}; shadowed ${skill.path}.`);
          } else {
            skills.set(skill.name, skill);
          }
        }
      }
      if (selected.length < entries.length) {
        overflowed.push({
          root: canonical,
          boundary: boundary ?? canonical,
          scope,
          names: new Set(entries.slice(maxCandidates).map(({ name }) => name)),
        });
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (!missing(error)) {
        incomplete = true;
        console.warn(`Could not scan a ${scope} skill directory.`);
      }
    }
  }
  return { sources: [...skills.values()], incomplete };
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
    throw new SkillLoadError(`Skill ${source.name} is no longer available.`);
  }
  const text = await readSkill(path, false, signal).catch(() => '');
  signal?.throwIfAborted();
  if (text === undefined) {
    throw new SkillLoadError(`Skill ${source.name} exceeds the 1 MiB source file limit.`);
  }
  const parsed = parseSkill(text);
  if (!parsed?.body || parsed.metadata.name !== source.name) {
    throw new SkillLoadError(`Could not load skill ${source.name}. Check SKILL.md.`);
  }
  if (
    actor === 'model'
      ? parsed.metadata['disable-model-invocation'] === true
      : parsed.metadata['user-invocable'] === false
  ) {
    throw new SkillLoadError(`Skill ${source.name} does not allow this type of invocation.`);
  }
  return parsed.body;
}
