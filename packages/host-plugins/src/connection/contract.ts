import type { HttpService } from '../http/contract.js';

declare module '@workspace/runtime' {
  interface Services {
    http: HttpService;
  }
}
