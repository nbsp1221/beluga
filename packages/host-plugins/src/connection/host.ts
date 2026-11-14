import type { Plugin } from '@workspace/runtime';
import { HOST_STATUS_PATH, type HostStatus } from '@workspace/protocol/host';
import { Hono } from 'hono';
import './contract.js';

export const connectionHost: Plugin = {
  id: 'connection',
  provides: ['http'],
  setup(context) {
    const app = new Hono().get(HOST_STATUS_PATH, (request) =>
      request.json({ status: 'ready' } satisfies HostStatus),
    );
    context.provide('http', { fetch: app.fetch });
  },
};
