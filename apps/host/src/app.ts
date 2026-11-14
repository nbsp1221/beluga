import {
  AGENT_PRESETS_PATH,
  AUTH_PATH,
  CONVERSATION_PATH,
  PROVIDERS_PATH,
  WORKSPACES_PATH,
  WORKSPACE_FOLDERS_PATH,
} from '@workspace/protocol/host';
import { createRuntime } from '@workspace/runtime';
import { type HostOptions, hostPlugins } from './product.js';

const conversationRoutes = [CONVERSATION_PATH, PROVIDERS_PATH, AGENT_PRESETS_PATH];
let connectedHostActive = false;

export async function createHost(options: HostOptions = {}) {
  if (options.web && (!options.auth || !options.harness)) {
    throw new Error('The connected website requires authentication and a harness.');
  }

  if (!options.harness) {
    return startHost(options);
  }
  if (connectedHostActive) {
    throw new Error('A connected Beluga Host is already active in this process.');
  }

  // Flue's process-wide state and startup recovery both need exclusive ownership.
  connectedHostActive = true;
  try {
    const host = await startHost(options);
    let disposal: Promise<void> | undefined;
    return {
      ...host,
      dispose: () =>
        (disposal ??= host.dispose().finally(() => {
          connectedHostActive = false;
        })),
    };
  } catch (error) {
    connectedHostActive = false;
    throw error;
  }
}

async function startHost(options: HostOptions) {
  const runtime = await createRuntime(hostPlugins(options));
  const http = runtime.get('http');
  const conversation = options.harness ? runtime.get('conversationHttp') : undefined;
  const auth = options.auth ? runtime.get('auth') : undefined;
  const workspace = options.harness ? runtime.get('workspaceHttp') : undefined;

  return {
    async fetch(this: void, request: Request) {
      const { pathname, search } = new URL(request.url);

      if (workspace && (pathname === WORKSPACES_PATH || pathname === WORKSPACE_FOLDERS_PATH)) {
        return workspace.fetch(request);
      }
      if (
        conversation &&
        conversationRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))
      ) {
        return conversation.fetch(request);
      }

      if (auth?.http && pathname.startsWith(`${AUTH_PATH}/`)) {
        return auth.http.fetch(request);
      }

      if (options.web && auth && !pathname.startsWith('/api/')) {
        if (
          pathname !== '/login' &&
          !pathname.startsWith('/assets/') &&
          !(await auth.authenticate(request))
        ) {
          return new Response(null, {
            status: 302,
            headers: {
              'Location': `/login?next=${encodeURIComponent(pathname + search)}`,
              'Cache-Control': 'no-store',
            },
          });
        }
        return options.web.fetch(request);
      }
      return http.fetch(request);
    },
    authenticate: (request: Request) => auth?.authenticate(request) ?? false,
    abortConversations: () => conversation?.abortConversations(),
    dispose: () => runtime.dispose(),
  };
}
