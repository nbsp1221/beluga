import type { AssistantMessagePart, Session } from '@workspace/client/bootstrap/demo';

const question = 'Where does the server get its port?';
const model = 'example-model';

export const exampleFileRead = {
  id: 'read',
  type: 'tool',
  name: 'read',
  status: 'completed',
  input: { path: 'src/config.ts' },
  output: 'export const port = Number(process.env.PORT ?? 8080);',
} satisfies Extract<AssistantMessagePart, { type: 'tool' }>;

export const exampleSession = {
  id: 'sample',
  title: question,
  draft: '',
  runSettings: { model, effort: 'default' },
  messages: [
    { id: 'question', role: 'user', text: question },
    {
      id: 'answer',
      role: 'assistant',
      parts: [
        exampleFileRead,
        {
          id: 'reply',
          type: 'text',
          text: 'The server reads `PORT` in `src/config.ts`. It defaults to `8080` when the variable is unset.',
          streaming: false,
        },
      ],
      activity: { state: 'completed', durationMs: 1800 },
    },
  ],
  usage: {
    turns: 1,
    steps: 2,
    modelMs: 1710,
    toolMs: 90,
    averageFirstOutputMs: 450,
    outputTokensPerSecond: 74,
    tokens: 726,
    input: 666,
    output: 60,
    cacheRead: 0,
    cacheWrite: 0,
    context: { status: 'available', model, inputTokens: 410, contextWindow: 128_000 },
  },
} satisfies Omit<Session, 'workspaceId'>;
