export interface WriteInput {
  path: string;
  content: string;
}

export interface WriteOperations {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
}

export type Write = (
  cwd: string,
  input: WriteInput,
  options?: { operations?: WriteOperations; signal?: AbortSignal },
) => Promise<string>;
