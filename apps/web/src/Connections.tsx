import { DESKTOP_CONNECTIONS_PATH } from '@workspace/protocol/host';
import { Button } from '@workspace/ui/components/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { Spinner } from '@workspace/ui/components/spinner';
import { type SubmitEvent, useEffect, useId, useRef, useState } from 'react';

export class ConnectionError extends Error {
  readonly needsCode: boolean;

  constructor(message: string, needsCode = false) {
    super(message);
    this.needsCode = needsCode;
  }
}

export function Connections({
  remoteAddress,
  connect,
  selectLocal,
}: {
  remoteAddress?: string;
  connect: (address: string, code: string, signal: AbortSignal) => Promise<void>;
  selectLocal: () => Promise<void>;
}) {
  const addressId = useId();
  const codeId = useId();
  const errorId = useId();
  const [address, setAddress] = useState(remoteAddress ?? '');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operationRef = useRef<AbortController>(null);
  const codeFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    if (!remoteAddress) {
      void fetch(DESKTOP_CONNECTIONS_PATH, { signal: controller.signal })
        .then(async (response) => {
          if (response.ok) {
            const result: unknown = await response.json();
            if (
              result &&
              typeof result === 'object' &&
              'address' in result &&
              typeof result.address === 'string'
            ) {
              const saved = result.address;
              setAddress((current) => current || saved);
            }
          }
        })
        .catch(() => undefined);
    }
    return () => {
      controller.abort();
      operationRef.current?.abort();
    };
  }, [remoteAddress]);

  useEffect(() => {
    if (needsCode && !busy) {
      codeFieldRef.current?.focus();
    }
  }, [needsCode, busy]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operationRef.current) {
      return;
    }
    const controller = new AbortController();
    operationRef.current = controller;
    setError('');
    setBusy(true);
    try {
      await connect(address, code, controller.signal);
    } catch (cause) {
      if (controller.signal.aborted) {
        return;
      }
      if (cause instanceof ConnectionError && cause.needsCode) {
        setNeedsCode(true);
        setCode('');
        if (!code) {
          return;
        }
      }
      setError(
        cause instanceof ConnectionError ? cause.message : 'Could not connect to the server.',
      );
    } finally {
      operationRef.current = null;
      setBusy(false);
    }
  }

  return (
    <FieldGroup>
      <Field orientation="responsive">
        <FieldContent>
          <FieldTitle>This computer</FieldTitle>
          {!remoteAddress && <FieldDescription>Current connection</FieldDescription>}
        </FieldContent>
        {remoteAddress && (
          <Button
            type="button"
            variant="outline"
            className="touch-target self-center"
            onClick={() => {
              operationRef.current?.abort();
              void selectLocal().catch(() => setError('Could not open this computer. Try again.'));
            }}
          >
            Open
          </Button>
        )}
      </Field>
      {remoteAddress && (
        <>
          <FieldSeparator />
          <Field>
            <FieldContent>
              <FieldTitle>Current connection</FieldTitle>
              <FieldDescription className="break-all">{remoteAddress}</FieldDescription>
            </FieldContent>
          </Field>
        </>
      )}
      <FieldSeparator />
      <form className="flex min-w-0 flex-col gap-5" onSubmit={(event) => void submit(event)}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={addressId}>Server address</FieldLabel>
            <Input
              id={addressId}
              type="url"
              required
              placeholder="https://beluga.example.com"
              value={address}
              disabled={busy}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setAddress(event.target.value);
                setCode('');
                setNeedsCode(false);
                setError('');
              }}
            />
          </Field>
          {needsCode && (
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor={codeId}>Access code</FieldLabel>
              <Input
                ref={codeFieldRef}
                id={codeId}
                type="password"
                autoComplete="off"
                required
                value={code}
                disabled={busy}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => {
                  setCode(event.target.value);
                  setError('');
                }}
              />
            </Field>
          )}
        </FieldGroup>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <FieldError id={errorId}>{error}</FieldError>
            <FieldDescription role="status">{busy ? 'Connecting…' : ''}</FieldDescription>
          </div>
          <Button type="submit" className="touch-target" disabled={busy}>
            {busy && <Spinner data-icon="inline-start" aria-hidden="true" />}
            Connect
          </Button>
        </div>
      </form>
    </FieldGroup>
  );
}
