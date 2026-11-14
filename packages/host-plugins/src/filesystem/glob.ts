export interface GlobInput {
  pattern: string;
  path?: string;
  limit?: number;
}

export type Glob = (cwd: string, input: GlobInput, signal?: AbortSignal) => Promise<string>;
