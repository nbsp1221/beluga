import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { FlueError } from '@flue/runtime';
import { workspaceInstructionsRootError } from '@workspace/protocol/host';
import type { WorkspaceFiles } from '../workspace/services.js';
import { FileReadError } from '../filesystem/read.js';

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

interface ScopeUpdate {
  directory: string;
  file?: InstructionFile;
  unavailable?: boolean;
}

export interface InstructionState {
  instance?: string;
  signalIds?: string[];
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

async function projectRoot(
  files: WorkspaceFiles,
  cwd: string,
  markers: readonly string[],
  signal?: AbortSignal,
) {
  for (let directory = cwd; ; directory = dirname(directory)) {
    signal?.throwIfAborted();
    for (const name of markers) {
      const marker = await files.stat(join(directory, name)).catch((error: unknown) => {
        if (!isMissing(error)) {
          throw error;
        }
      });
      if (marker) {
        return directory;
      }
    }
    if (dirname(directory) === directory) {
      return cwd;
    }
  }
}

export async function resolveInstructionRoot(
  files: WorkspaceFiles,
  cwd: string,
  signal?: AbortSignal,
  options: InstructionOptions = {},
) {
  try {
    if (relative(cwd, await files.realpath(cwd))) {
      throw new Error('The registered workspace now points to a different folder.');
    }
    return await projectRoot(
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
): Promise<ScopeUpdate> {
  if (!global) {
    try {
      if (relative(directory, await files.realpath(directory))) {
        return { directory };
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (isMissing(error)) {
        return { directory };
      }
      console.warn('Beluga could not resolve the agent instructions directory', directory);
      return { directory, unavailable: true };
    }
  }
  for (const filename of filenames) {
    signal?.throwIfAborted();
    const path = join(directory, filename);
    try {
      const file = await readInstruction(files, path, maxSourceBytes, signal);
      if (!file) {
        return { directory, unavailable: true };
      }
      if (file.text) {
        return { directory, file: { directory, path, ...file } };
      }
      if (!global) {
        return { directory };
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
      return { directory, unavailable: true };
    }
  }
  return { directory };
}

function applyScopes(
  state: InstructionState,
  updates: readonly ScopeUpdate[],
  maxBytes: number,
): InstructionState {
  const files = new Map(state.project.map((file) => [file.directory, file]));
  const omitted = new Set(state.omitted);
  for (const { directory, file, unavailable } of updates) {
    if (unavailable) {
      continue;
    }
    omitted.delete(directory);
    if (file) {
      files.set(directory, retainTruncation(files.get(directory), file));
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
  options: InstructionOptions = {},
  rebuild = false,
): Promise<InstructionState> {
  const { maxBytes, maxSourceBytes } = { ...defaults, ...options };
  const update = await readScope(files, directory, true, maxSourceBytes, signal);
  const known = previous.root === root ? previous : initialInstructions;
  const global = update.unavailable ? previous.global : capGlobal(previous, update.file, maxBytes);
  const directories = new Set([
    ...ancestorChain(root, cwd),
    ...known.project.map((file) => file.directory),
    ...(rebuild ? known.omitted : []),
  ]);
  const updates: ScopeUpdate[] = [];
  for (const scope of directories) {
    if (isWithin(root, scope) && (rebuild || !known.omitted.includes(scope))) {
      updates.push(await readScope(files, scope, false, maxSourceBytes, signal));
    }
  }
  return applyScopes({ ...known, root, global }, updates, maxBytes);
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
  const { maxBytes, maxSourceBytes } = { ...defaults, ...options };
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
    return (previous: InstructionState) => previous;
  }
  const root = await resolveInstructionRoot(files, cwd, signal, options);
  const globalUpdate = await readScope(files, directory, true, maxSourceBytes, signal);
  const updates: ScopeUpdate[] = [];
  const knownScopes = previous.root === root ? previous.project.map((file) => file.directory) : [];
  for (const scope of new Set([...ancestorChain(root, cwd), ...knownScopes, ...directories])) {
    if (previous.root === root && previous.omitted.includes(scope)) {
      continue;
    }
    updates.push(await readScope(files, scope, false, maxSourceBytes, signal));
  }
  return (previous: InstructionState) => {
    const known =
      previous.root === root
        ? previous
        : { ...initialInstructions, instance: previous.instance, signalIds: previous.signalIds };
    const global = globalUpdate.unavailable
      ? previous.global
      : capGlobal(known, globalUpdate.file, maxBytes);
    return applyScopes(
      { ...known, root, global },
      updates.filter(({ directory: scope }) => !known.omitted.includes(scope)),
      maxBytes,
    );
  };
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

type Change = { action: 'add' | 'replace' | 'remove'; path: string };

export function diffInstructions(
  previous: InstructionState,
  next: InstructionState,
  rebuild = false,
) {
  const filesFor = (state: InstructionState) => {
    const entries = state.project.map(
      (file) => [instructionPath(state, file), instructionSection(state, file)] as const,
    );
    if (state.global) {
      entries.unshift([
        instructionPath(state, state.global, true),
        instructionSection(state, state.global, true),
      ]);
    }
    return new Map(entries);
  };

  const before = filesFor(previous);
  const after = filesFor(next);
  const changes: Change[] = [];
  const sections: string[] = [];
  for (const path of before.keys()) {
    if (!after.has(path)) {
      changes.push({ action: 'remove', path });
      sections.push(removalSection(path));
    }
  }
  for (const [path, section] of after) {
    if (rebuild || before.get(path) !== section) {
      const action = before.has(path) ? 'replace' : 'add';
      changes.push({ action, path });
      sections.push(action === 'replace' ? updateNotice + section : section);
    }
  }
  if (changes.length === 0) {
    return;
  }
  if (next.omitted.length > 0) {
    sections.unshift(omissionNotice);
  }
  if (rebuild) {
    sections.unshift(resetNotice);
  }
  return {
    kind: 'signal',
    type: 'agent-instructions',
    tagName: 'system-reminder',
    body: [introduction, ...sections].join('\n\n'),
    attributes: { id: crypto.randomUUID(), changes: JSON.stringify(changes) },
  } as const;
}
