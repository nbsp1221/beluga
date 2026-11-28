import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { FlueError } from '@flue/runtime';
import { workspaceInstructionsRootError } from '@workspace/protocol/host';
import * as v from 'valibot';
import type { WorkspaceFiles } from '../workspace/services.js';
import { FileReadError } from '../filesystem/read.js';
import { resolveProjectRoot } from '../workspace/project-root.js';

const filenames = ['AGENTS.override.md', 'AGENTS.md'];

export interface InstructionOptions {
  maxBytes?: number;
  maxSourceBytes?: number;
  projectRootMarkers?: readonly string[];
}

const defaults = { maxBytes: 64 * 1024, maxSourceBytes: 1024 * 1024, projectRootMarkers: ['.git'] };

export class WorkspaceInstructionsRootError extends FlueError {
  constructor(cause: unknown) {
    super({
      ...workspaceInstructionsRootError,
      details: 'Check whether the workspace folder and its project metadata can be read.',
      dev: '',
      cause,
    });
  }
}

interface InstructionFile {
  directory: string;
  path: string;
  text: string;
  digest: string;
  truncated: boolean;
}

type ScopeObservation =
  | { status: 'present'; file: InstructionFile }
  | { status: 'absent' | 'unavailable' };

/** Saved discovery state for the next scan, including scopes hidden by compaction. */
export interface InstructionState {
  instance?: string;
  root?: string;
  global?: InstructionFile;
  project: InstructionFile[];
  omitted: string[];
}

export const initialInstructions: InstructionState = { project: [], omitted: [] };

function isMissing(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

function isWithin(root: string, target: string) {
  const distance = relative(root, target);
  return distance !== '..' && !distance.startsWith(`..${sep}`) && !isAbsolute(distance);
}

function ancestorChain(root: string, directory: string) {
  const directories = [directory];
  while (directory !== root) {
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directories.push(parent);
    directory = parent;
  }
  return directories.reverse();
}

export async function resolveInstructionRoot(
  files: WorkspaceFiles,
  cwd: string,
  signal?: AbortSignal,
  options: InstructionOptions = {},
) {
  try {
    return await resolveProjectRoot(
      files,
      cwd,
      options.projectRootMarkers ?? defaults.projectRootMarkers,
      signal,
    );
  } catch (error) {
    signal?.throwIfAborted();
    throw new WorkspaceInstructionsRootError(error);
  }
}

function decode(bytes: Buffer, limit: number) {
  return new TextDecoder()
    .decode(bytes.subarray(0, limit), {
      stream: bytes.length > limit,
    })
    .trim();
}

async function readInstruction(
  files: WorkspaceFiles,
  path: string,
  maxSourceBytes: number,
  signal?: AbortSignal,
) {
  const identity = await files.realpath(path);
  if ((await files.stat(identity)).size > maxSourceBytes) {
    return undefined;
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of files.read({ absolutePath: identity }, { signal })) {
    const slice = Buffer.from(chunk);
    chunks.push(slice);
    length += slice.length;
    if (length > maxSourceBytes) {
      return undefined;
    }
  }
  signal?.throwIfAborted();
  const text = decode(Buffer.concat(chunks, length), length);
  return {
    text,
    digest: createHash('sha256').update(text).digest('hex'),
    truncated: false,
  };
}

function retainTruncation(previous: InstructionFile | undefined, file: InstructionFile) {
  return previous?.truncated && previous.path === file.path && previous.digest === file.digest
    ? previous
    : file;
}

async function readScope(
  files: WorkspaceFiles,
  directory: string,
  global: boolean,
  maxSourceBytes: number,
  signal?: AbortSignal,
): Promise<ScopeObservation> {
  if (!global) {
    try {
      if (relative(directory, await files.realpath(directory))) {
        return { status: 'absent' };
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (isMissing(error)) {
        return { status: 'absent' };
      }
      console.warn('Beluga could not resolve the agent instructions directory', directory);
      return { status: 'unavailable' };
    }
  }
  for (const filename of filenames) {
    signal?.throwIfAborted();
    const path = join(directory, filename);
    try {
      const file = await readInstruction(files, path, maxSourceBytes, signal);
      if (!file) {
        return { status: 'unavailable' };
      }
      if (file.text) {
        return { status: 'present', file: { directory, path, ...file } };
      }
      if (!global) {
        return { status: 'absent' };
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (
        isMissing(error) ||
        (error instanceof FileReadError &&
          (error.code === 'NOT_FOUND' || error.code === 'NOT_A_FILE'))
      ) {
        continue;
      }
      console.warn('Beluga could not read agent instructions', path);
      return { status: 'unavailable' };
    }
  }
  return { status: 'absent' };
}

function applyScopes(
  state: InstructionState,
  observations: ReadonlyMap<string, ScopeObservation>,
  maxBytes: number,
): InstructionState {
  const files = new Map(state.project.map((file) => [file.directory, file]));
  const omitted = new Set(state.omitted);
  for (const [directory, observation] of observations) {
    if (observation.status === 'unavailable') {
      continue;
    }
    omitted.delete(directory);
    if (observation.status === 'present') {
      files.set(directory, retainTruncation(files.get(directory), observation.file));
    } else {
      files.delete(directory);
    }
  }
  const ordered = [...files.values()].sort(
    (left, right) =>
      left.directory.split(sep).length - right.directory.split(sep).length ||
      left.directory.localeCompare(right.directory, 'en'),
  );
  const project: InstructionFile[] = [];
  const removalBytes = new Map(
    state.project.map((file) => {
      const path = instructionPath(state, file);
      return [path, Buffer.byteLength(removalSection(path) + '\n\n')];
    }),
  );
  let remaining =
    contentsBudget(maxBytes) - [...removalBytes.values()].reduce((sum, bytes) => sum + bytes, 0);
  const nearestFirst = ordered.reverse();
  for (const [index, file] of nearestFirst.entries()) {
    // Keeping the same source frees the space reserved for its removal.
    const available = remaining + (removalBytes.get(instructionPath(state, file)) ?? 0);
    const size = sectionBytes(state, file);
    if (size <= available) {
      project.push(file);
      remaining = available - size;
    } else {
      const partial =
        project.length === 0 ? truncateInstruction(state, file, available) : undefined;
      if (partial) {
        project.push(partial);
      } else {
        omitted.add(file.directory);
      }
      for (const broader of nearestFirst.slice(index + 1)) {
        omitted.add(broader.directory);
      }
      break;
    }
  }
  return { ...state, project: project.reverse(), omitted: [...omitted].sort() };
}

export async function refreshInstructions(
  files: WorkspaceFiles,
  directory: string,
  cwd: string,
  root: string,
  previous: InstructionState,
  signal: AbortSignal | undefined,
  options: InstructionOptions,
  before: InstructionVersions,
  {
    touched = [],
    retryOmitted = false,
  }: { touched?: Iterable<string>; retryOmitted?: boolean } = {},
) {
  const { maxBytes, maxSourceBytes } = { ...defaults, ...options };
  const globalUpdate = await readScope(files, directory, true, maxSourceBytes, signal);
  const known =
    previous.root === root ? previous : { ...initialInstructions, instance: previous.instance };
  const global =
    globalUpdate.status === 'unavailable'
      ? previous.global
      : capGlobal(
          previous,
          globalUpdate.status === 'present' ? globalUpdate.file : undefined,
          maxBytes,
        );
  const directories = new Set([
    ...ancestorChain(root, cwd),
    ...known.project.map((file) => file.directory),
    ...(retryOmitted ? known.omitted : []),
    ...touched,
  ]);

  // A visible signal identifies a scope even if the saved discovery state predates it.
  const appliedScopes = new Map<string, string | undefined>();
  for (const path of before.keys()) {
    if (filenames.some((filename) => path === `Host ${filename}`)) {
      appliedScopes.set(path, undefined);
      continue;
    }
    const target = join(root, path);
    const scope = dirname(target);
    if (
      previous.root === root &&
      filenames.includes(basename(target)) &&
      (isWithin(cwd, scope) || directories.has(scope)) &&
      relative(root, target).split(sep).join('/') === path
    ) {
      appliedScopes.set(path, scope);
      directories.add(scope);
    }
  }

  const observed = new Map<string, ScopeObservation>();
  for (const scope of directories) {
    if (isWithin(root, scope) && (retryOmitted || !known.omitted.includes(scope))) {
      observed.set(scope, await readScope(files, scope, false, maxSourceBytes, signal));
    }
  }
  const state = applyScopes({ ...known, root, global }, observed, maxBytes);
  const retainedScopes = new Set<string | undefined>();
  const after = new Map<string, InstructionVersion>();

  for (const [path, scope] of appliedScopes) {
    const observation = scope === undefined ? globalUpdate : observed.get(scope);
    if (observation?.status === 'unavailable') {
      // Keep what the model can already see until this scope can be read again.
      retainedScopes.add(scope);
      after.set(path, { digest: before.get(path) });
    }
  }
  for (const section of instructionSections(state)) {
    if (!retainedScopes.has(section.scope)) {
      after.set(section.path, section);
    }
  }
  return { state, changes: instructionChanges(before, after, state.omitted.length > 0) };
}

export async function discoverTouchedInstructions(
  files: WorkspaceFiles,
  directory: string,
  cwd: string,
  paths: readonly string[],
  previous: InstructionState,
  signal?: AbortSignal,
  options: InstructionOptions = {},
) {
  const directories = new Set<string>();
  for (const path of paths) {
    signal?.throwIfAborted();
    const target = await files.realpath(path).catch(() => undefined);
    if (target && isWithin(cwd, target)) {
      for (const directory of ancestorChain(cwd, dirname(target))) {
        directories.add(directory);
      }
    }
  }
  if (directories.size === 0) {
    return undefined;
  }
  const root = await resolveInstructionRoot(files, cwd, signal, options);
  return refreshInstructions(
    files,
    directory,
    cwd,
    root,
    previous,
    signal,
    options,
    instructionVersions(previous),
    { touched: directories },
  );
}

const introduction =
  'Workspace instructions guide work in the listed scopes. Prefer closer applicable instructions. Workspace instructions do not override system, developer, or direct user instructions.';
const resetNotice = 'This context supersedes all previous workspace instructions.';
const omissionNotice = 'Some instruction folders were omitted due to the size limit.';
const updateNotice = 'Updated instructions\n';

function contentsBudget(maxBytes: number) {
  return maxBytes - Buffer.byteLength([introduction, resetNotice, omissionNotice, ''].join('\n\n'));
}

function relativePath(state: InstructionState, path: string) {
  return (
    relative(state.root ?? dirname(path), path)
      .split(sep)
      .join('/') || '.'
  );
}

function instructionPath(state: InstructionState, file: InstructionFile, global = false) {
  return global ? `Host ${basename(file.path)}` : relativePath(state, file.path);
}

function instructionSection(state: InstructionState, file: InstructionFile, global = false) {
  const path = instructionPath(state, file, global);
  const scope = global ? 'All work on this Host' : relativePath(state, file.directory);
  return `### ${JSON.stringify(path)}${file.truncated ? ' (truncated)' : ''}\nScope: ${JSON.stringify(scope)}\n\n${file.text}`;
}

function removalSection(path: string) {
  return `Instructions removed: ${JSON.stringify(path)}\nThe previous instructions from this file no longer apply.`;
}

function sectionBytes(state: InstructionState, file: InstructionFile, global = false) {
  return Buffer.byteLength(`${updateNotice}${instructionSection(state, file, global)}\n\n`);
}

function capGlobal(state: InstructionState, file: InstructionFile | undefined, budget: number) {
  if (!file) {
    return undefined;
  }
  file = retainTruncation(state.global, file);
  const oldPath = state.global && instructionPath(state, state.global, true);
  const removalBudget =
    oldPath && oldPath !== instructionPath(state, file, true)
      ? Buffer.byteLength(removalSection(oldPath) + '\n\n')
      : 0;
  const available = contentsBudget(budget) - removalBudget;
  return sectionBytes(state, file, true) <= available
    ? file
    : truncateInstruction(state, file, available, true);
}

function truncateInstruction(
  state: InstructionState,
  file: InstructionFile,
  budget: number,
  global = false,
) {
  const truncated = { ...file, text: '', truncated: true };
  const available = budget - sectionBytes(state, truncated, global);
  return available > 0
    ? { ...truncated, text: decode(Buffer.from(file.text), available) }
    : undefined;
}

const changeSchema = v.array(
  v.object({
    action: v.picklist(['add', 'replace', 'remove']),
    path: v.string(),
    digest: v.optional(v.string()),
  }),
);

type Change = v.InferOutput<typeof changeSchema>[number];
type InstructionVersions = ReadonlyMap<string, string | undefined>;

interface InstructionVersion {
  digest: string | undefined;
  text?: string;
}

interface InstructionSection {
  path: string;
  scope?: string;
  text: string;
  digest: string;
}

function instructionSections(state: InstructionState): InstructionSection[] {
  const sections = state.project.map<Omit<InstructionSection, 'digest'>>((file) => ({
    path: instructionPath(state, file),
    scope: file.directory,
    text: instructionSection(state, file),
  }));
  if (state.global) {
    sections.unshift({
      path: instructionPath(state, state.global, true),
      text: instructionSection(state, state.global, true),
    });
  }
  return sections.map((section) => ({
    ...section,
    digest: createHash('sha256').update(section.text).digest('hex'),
  }));
}

export function instructionVersions(state: InstructionState): InstructionVersions {
  return new Map(instructionSections(state).map(({ path, digest }) => [path, digest]));
}

export function visibleInstructionVersions(
  signals: readonly { content: string; attributes?: Readonly<Record<string, string>> }[],
): InstructionVersions {
  const versions = new Map<string, string | undefined>();
  for (const { content, attributes } of signals) {
    if (content.startsWith(`${introduction}\n\n${resetNotice}`)) {
      versions.clear();
    }
    const rawChanges = attributes?.changes;
    if (!rawChanges) {
      continue;
    }
    let changes: unknown;
    try {
      changes = JSON.parse(rawChanges);
    } catch {
      continue;
    }
    const parsed = v.safeParse(changeSchema, changes);
    if (!parsed.success) {
      continue;
    }
    for (const { action, path, digest } of parsed.output) {
      if (action === 'remove') {
        versions.delete(path);
      } else {
        versions.set(path, digest);
      }
    }
  }
  return versions;
}

function instructionChanges(
  before: InstructionVersions,
  after: ReadonlyMap<string, InstructionVersion>,
  omitted: boolean,
) {
  const changes: Change[] = [];
  const sections: string[] = [];
  for (const path of before.keys()) {
    if (!after.has(path)) {
      changes.push({ action: 'remove', path });
      sections.push(removalSection(path));
    }
  }
  for (const [path, { text, digest }] of after) {
    if (text !== undefined && before.get(path) !== digest) {
      const action = before.has(path) ? 'replace' : 'add';
      changes.push({ action, path, digest });
      sections.push(action === 'replace' ? updateNotice + text : text);
    }
  }
  if (changes.length === 0) {
    return;
  }
  if (omitted) {
    sections.unshift(omissionNotice);
  }
  return {
    kind: 'signal',
    type: 'agent-instructions',
    tagName: 'system-reminder',
    body: [introduction, ...sections].join('\n\n'),
    attributes: { id: crypto.randomUUID(), changes: JSON.stringify(changes) },
  } as const;
}
