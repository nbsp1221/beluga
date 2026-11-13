export function createHostRequest(signal: AbortSignal, fetchHost: typeof fetch) {
  return async (path: string, body?: object, method = body ? 'POST' : 'GET') => {
    const response = await fetchHost(
      path,
      body
        ? {
            signal,
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : { signal, method },
    );

    const value: unknown = await response.json();
    if (!response.ok) {
      const error = value && typeof value === 'object' && 'error' in value ? value.error : null;
      throw new HostRequestError(
        response.status,
        typeof error === 'string' ? error : 'Host request failed.',
      );
    }
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
