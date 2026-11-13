export interface ShellOptions {
  onData(data: Buffer): void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

export type RunShell = (
  command: string,
  cwd: string,
  options: ShellOptions,
) => Promise<{ exitCode: number | null }>;
