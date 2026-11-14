export interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}

export type Grep = (cwd: string, input: GrepInput, signal?: AbortSignal) => Promise<string>;
