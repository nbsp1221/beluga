import { AUTH_PATH } from '@workspace/protocol/host';

export function goToLogin() {
  const { pathname, search } = window.location;
  window.location.replace(`/login?next=${encodeURIComponent(pathname + search)}`);
}

export async function protectedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401) {
    goToLogin();
  }
  return response;
}

export async function visitSite() {
  const response = await protectedFetch(`${AUTH_PATH}/visit`, {
    method: 'POST',
  });
  if (response.status === 401) {
    return false;
  }
  if (!response.ok) {
    throw new Error('Could not verify the Beluga session.');
  }
  return true;
}
