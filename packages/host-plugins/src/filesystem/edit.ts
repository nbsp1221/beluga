export interface EditInput {
  path: string;
  edits: { oldText: string; newText: string }[];
}

export interface EditOperations {
  access(path: string): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, content: string): Promise<void>;
}

export type Edit = (
  cwd: string,
  input: EditInput,
  options?: { operations?: EditOperations; signal?: AbortSignal },
) => Promise<string>;
