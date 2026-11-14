import { AUTH_PATH } from '@workspace/protocol/host';
import { BelugaMark } from '@workspace/ui/components/beluga-mark';
import { Button } from '@workspace/ui/components/button';
import { Field, FieldError, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { useState } from 'react';

export { visitSite } from './session.js';

function loginDestination(search: string, origin: string) {
  const next = new URLSearchParams(search).get('next');
  if (!next?.startsWith('/')) {
    return '/';
  }

  const destination = new URL(next, origin);
  if (destination.origin !== origin || destination.pathname === '/login') {
    return '/';
  }

  return destination.pathname + destination.search + destination.hash;
}

export function Login() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (code: FormDataEntryValue | null) => {
    if (pending) {
      return;
    }
    setPending(true);
    setError('');
    try {
      const response = await fetch(`${AUTH_PATH}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? 'The access code is incorrect.'
            : response.status === 429
              ? 'Too many attempts. Try again in a minute.'
              : 'Could not sign in. Try again.',
        );
        return;
      }

      const { search, origin } = window.location;
      window.location.replace(loginDestination(search, origin));
    } catch {
      setError('Could not sign in. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <section className="w-full max-w-sm rounded-xl border bg-card p-6 text-card-foreground">
        <h1 className="mb-4 flex items-center gap-2 text-xl font-semibold">
          <BelugaMark />
          Sign in to Beluga
        </h1>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(new FormData(event.currentTarget).get('code'));
          }}
        >
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="access-code">Access code</FieldLabel>
            <Input
              id="access-code"
              name="code"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error' : undefined}
            />
            <FieldError id="login-error">{error}</FieldError>
          </Field>
          <Button type="submit" disabled={pending}>
            Sign in
          </Button>
        </form>
      </section>
    </main>
  );
}
