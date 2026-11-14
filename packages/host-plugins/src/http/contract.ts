export interface HttpService {
  fetch(this: void, request: Request): Response | Promise<Response>;
}
