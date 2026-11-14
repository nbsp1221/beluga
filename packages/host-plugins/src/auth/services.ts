import type { HttpService } from '../http/contract.js';

export interface HostAuth {
  authenticate(request: Request): boolean | Promise<boolean>;
  http?: HttpService;
}

export function acceptsSiteRequest(request: Request, origin: string) {
  return (
    request.method === 'GET' ||
    request.method === 'HEAD' ||
    request.headers.get('origin') === origin
  );
}

declare module '@workspace/runtime' {
  interface Services {
    auth: HostAuth;
  }
}
