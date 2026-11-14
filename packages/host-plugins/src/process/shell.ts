export interface ShellOptions {
  onData(data: Buffer): void;
  signal?: AbortSignal;
  /** Maximum runtime in seconds. Omit it to run without a deadline. */
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

export type RunShell = (
  command: string,
  cwd: string,
  options: ShellOptions,
) => Promise<{ exitCode: number | null }>;
