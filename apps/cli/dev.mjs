import { startServer } from '@workspace/host-server';

await startServer({ statusOnly: true, port: process.env.PORT });
