export function createHostRequest(signal: AbortSignal, fetchHost: typeof fetch) {
  return async (
    path: string,
    body?: object,
    method = body ? 'POST' : 'GET',
    requestSignal?: AbortSignal,
  ) => {
    const combined = requestSignal ? AbortSignal.any([signal, requestSignal]) : signal;
    const response = await fetchHost(
      path,
      body
        ? {
            signal: combined,
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : { signal: combined, method },
    );

    if (!response.ok) {
      const value: unknown = await response.json().catch(() => undefined);
      const error = value && typeof value === 'object' && 'error' in value ? value.error : null;
      throw new HostRequestError(
        response.status,
        typeof error === 'string' ? error : 'Host request failed.',
      );
    }
    if (response.status === 204 || response.status === 205 || method.toUpperCase() === 'HEAD') {
      return undefined;
    }
    const value: unknown = await response.json();
    return value;
  };
}

export class HostRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type HostRequest = ReturnType<typeof createHostRequest>;
