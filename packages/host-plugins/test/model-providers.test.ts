import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import { openModelProviders } from '../src/model-providers/adapter.js';

test('discovers models and streams with an API key at the configured HTTP endpoint', async ({
  onTestFinished,
}) => {
  const apiKey = 'test-provider-key';
  const modelId = 'test-model';
  const requests: { method?: string; path?: string; authorization?: string }[] = [];
  const endpoint = createServer((request, response) => {
    requests.push({
      method: request.method,
      path: request.url,
      authorization: request.headers.authorization,
    });
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      response.writeHead(401).end();
    } else if (request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: modelId }] }));
    } else if (request.url === '/v1/chat/completions') {
      const chunk = { id: 'chatcmpl-test', object: 'chat.completion.chunk', model: modelId };
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(
        `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      );
      response.end('data: [DONE]\n\n');
    } else {
      response.writeHead(404).end();
    }
  });

  // An isolated listener on an address excluded by the former three-name allowlist.
  const hostname = '127.0.0.2';
  endpoint.listen(0, hostname);
  onTestFinished(() => {
    endpoint.close();
    endpoint.closeAllConnections();
  });
  await once(endpoint, 'listening');
  const address = endpoint.address();
  assert(address && typeof address !== 'string');

  const dataDir = await mkdtemp(join(tmpdir(), 'beluga-provider-'));
  const models = createModels();
  const providers = openModelProviders(
    join(dataDir, 'providers.sqlite'),
    dataDir,
  )((provider) => {
    models.setProvider(provider);
  });
  onTestFinished(async () => {
    providers.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  await providers.connect({
    name: 'HTTP fixture',
    baseUrl: `http://${hostname}:${address.port}/v1`,
    apiKey,
    models: [],
  });
  const compatible = (await providers.list()).find(({ kind }) => kind === 'openai-compatible');
  assert(compatible);
  const model = models.getModel(compatible.id, modelId);
  assert(model);

  const result = await models
    .streamSimple(model, { messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }] })
    .result();
  expect(result).toMatchObject({ stopReason: 'stop', content: [{ type: 'text', text: 'Hello' }] });
  expect(requests).toEqual([
    { method: 'GET', path: '/v1/models', authorization: `Bearer ${apiKey}` },
    { method: 'POST', path: '/v1/chat/completions', authorization: `Bearer ${apiKey}` },
  ]);
});
