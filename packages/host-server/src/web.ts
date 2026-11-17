import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';

const hashedAsset = /^\/assets\/[^/]+-[\w-]{8}\.[a-z\d]+$/i;

export async function createWeb(directory: string, desktop = false) {
  const root = resolve(directory);
  const index = (await readFile(resolve(root, 'index.html'), 'utf8')).replace(
    '</head>',
    `<meta name="beluga-mode" content="connected">${desktop ? '<meta name="beluga-desktop">' : ''}</head>`,
  );

  const app = new Hono();
  app.use(
    '/assets/*',
    compress({
      contentTypeFilter:
        /^(?:text\/(?:css|javascript)|application\/javascript|image\/svg\+xml)(?:;|$)/i,
    }),
    serveStatic({
      root,
      onFound(_path, context) {
        if (hashedAsset.test(context.req.path)) {
          context.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.get('/assets/*', (c) => c.notFound());
  app.get('*', (c) => {
    c.header('Cache-Control', 'no-store');
    if (desktop) {
      c.header(
        'Content-Security-Policy',
        "script-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'",
      );
    }
    return c.html(index);
  });

  return { fetch: app.fetch };
}
