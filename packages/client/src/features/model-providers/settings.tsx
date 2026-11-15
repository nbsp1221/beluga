import type { ProviderSettings as Settings } from '@workspace/protocol/host';
import { Badge } from '@workspace/ui/components/badge';
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { Spinner } from '@workspace/ui/components/spinner';
import { cn } from '@workspace/ui/lib/utils';
import { Plus } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ModelProvidersClient } from './contract.js';

type Provider = Settings['providers'][number];
type ConnectionAction = 'connect' | 'disconnect';

function providerAction(provider: Provider): ConnectionAction | undefined {
  if (provider.status === 'connected' || provider.kind !== 'codex') {
    return 'disconnect';
  }
  if (provider.status === 'disconnected') {
    return 'connect';
  }
}

export function ProviderSettings({ client }: { client: ModelProvidersClient }) {
  const id = useId();
  const { settings } = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const restoreEntryFocusRef = useRef(false);

  useLayoutEffect(() => {
    if (!busy && restoreEntryFocusRef.current) {
      restoreEntryFocusRef.current = false;
      (addTriggerRef.current ?? nameInputRef.current)?.focus();
    }
  }, [adding, busy, settings]);

  function closeProviderForm() {
    restoreEntryFocusRef.current = true;
    setAdding(false);
  }

  useEffect(() => {
    let active = true;
    void client.refresh().catch(() => {
      if (active) {
        setError('Could not load providers.');
      }
    });
    return () => {
      active = false;
    };
  }, [client]);

  async function apply(
    change: () => Promise<Settings> | undefined,
    success: string,
    onSuccess?: (result: Settings) => void,
  ) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await change();
      if (result) {
        setStatus(success);
        onSuccess?.(result);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update providers.');
    } finally {
      setBusy(false);
    }
  }

  function changeConnection(provider: Provider, action: ConnectionAction, trigger: HTMLElement) {
    void apply(
      () =>
        action === 'disconnect' ? client.disconnectProvider(provider.id) : client.connectCodex(),
      action === 'disconnect' ? 'Provider disconnected.' : 'Provider connected.',
      (result) => {
        const updated = result.providers.find(({ id }) => id === provider.id);
        if (trigger === document.activeElement && (!updated || !providerAction(updated))) {
          restoreEntryFocusRef.current = true;
        }
      },
    );
  }

  function connectFromForm(form: HTMLFormElement) {
    const fields = new FormData(form);

    const readText = (key: string) => {
      const field = fields.get(key);

      return typeof field === 'string' ? field.trim() : '';
    };

    void apply(
      () =>
        client.connectProvider({
          name: readText('name'),
          baseUrl: readText('baseUrl'),
          apiKey: readText('apiKey'),
          models: readText('models')
            .split(',')
            .map((model) => model.trim())
            .filter(Boolean),
        }),
      'Provider connected.',
      closeProviderForm,
    );
  }

  const currentDefault = settings?.providers
    .flatMap(({ models }) => models)
    .find(({ id }) => id === settings.defaultModel);
  const feedback = (
    <>
      <FieldError>{error}</FieldError>
      <FieldDescription role="status" className={cn(!busy && !status && 'sr-only')}>
        {busy ? 'Updating providers…' : status}
      </FieldDescription>
    </>
  );

  return (
    <FieldGroup>
      {!settings && !error && <FieldDescription role="status">Loading providers…</FieldDescription>}
      {settings && (
        <>
          <ul className="flex min-w-0 flex-col divide-y">
            {settings.providers.map((provider) => {
              const action = providerAction(provider);
              return (
                <li key={provider.id} className="min-w-0 py-3 first:pt-0 last:pb-0">
                  <Field orientation="responsive">
                    <FieldContent className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <FieldTitle className="min-w-0 break-words">{provider.name}</FieldTitle>
                        <Badge variant="secondary">
                          {provider.status === 'connected'
                            ? 'Connected'
                            : provider.status === 'missing-login'
                              ? 'Host sign-in required'
                              : 'Disconnected'}
                        </Badge>
                      </div>
                      <FieldDescription className="break-all">
                        {provider.baseUrl ?? 'Uses the Codex login on this Host.'}
                      </FieldDescription>
                    </FieldContent>
                    {action && (
                      <Button
                        variant="outline"
                        className="touch-target shrink-0 self-center"
                        disabled={busy}
                        focusableWhenDisabled
                        aria-label={
                          action === 'disconnect' ? `Disconnect ${provider.name}` : undefined
                        }
                        onClick={(event) => changeConnection(provider, action, event.currentTarget)}
                      >
                        {action === 'disconnect' ? 'Disconnect' : 'Connect'}
                      </Button>
                    )}
                  </Field>
                </li>
              );
            })}
          </ul>
          {!adding ? (
            <Button
              ref={addTriggerRef}
              variant="outline"
              className="touch-target w-full"
              disabled={busy}
              onClick={() => {
                setError('');
                setStatus('');
                setAdding(true);
              }}
            >
              <Plus data-icon="inline-start" /> Add provider
            </Button>
          ) : (
            <form
              className="flex min-w-0 flex-col gap-5 rounded-lg border p-4"
              onSubmit={(event) => {
                event.preventDefault();
                connectFromForm(event.currentTarget);
              }}
            >
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">OpenAI-compatible</h3>
                <FieldDescription>Connect a Chat Completions endpoint.</FieldDescription>
              </div>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
                  <Input
                    ref={nameInputRef}
                    id={`${id}-name`}
                    name="name"
                    required
                    maxLength={80}
                    autoFocus
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-url`}>Base URL</FieldLabel>
                  <Input
                    id={`${id}-url`}
                    name="baseUrl"
                    type="url"
                    placeholder="https://gateway.example/v1"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-key`}>API key (optional)</FieldLabel>
                  <Input id={`${id}-key`} name="apiKey" type="password" autoComplete="off" />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-models`}>Model IDs (optional)</FieldLabel>
                  <Input id={`${id}-models`} name="models" aria-describedby={`${id}-models-help`} />
                  <FieldDescription id={`${id}-models-help`}>
                    Leave blank to discover models, or separate IDs with commas.
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="min-w-0 flex-1">{feedback}</div>
                <Button
                  type="button"
                  variant="ghost"
                  className="touch-target"
                  disabled={busy}
                  onClick={() => {
                    setError('');
                    closeProviderForm();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="touch-target"
                  disabled={busy}
                  focusableWhenDisabled
                >
                  {busy && <Spinner data-icon="inline-start" aria-hidden="true" />}
                  Connect provider
                </Button>
              </div>
            </form>
          )}
          {settings.providers.some(({ models }) => models.length > 0) && (
            <>
              <FieldSeparator />
              <Field orientation="responsive">
                <FieldLabel htmlFor={`${id}-default`}>Default model for new chats</FieldLabel>
                <Select
                  value={currentDefault?.id ?? 'none'}
                  disabled={busy}
                  onValueChange={(model) => {
                    if (model) {
                      void apply(
                        () => client.setDefaultModel(model === 'none' ? null : model),
                        'Default model saved.',
                      );
                    }
                  }}
                >
                  <SelectTrigger id={`${id}-default`} className="touch-target min-w-0">
                    <SelectValue>{currentDefault?.name ?? 'No default'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end" alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value="none" className="touch-target">
                        No default
                      </SelectItem>
                    </SelectGroup>
                    {settings.providers
                      .filter(({ models }) => models.length > 0)
                      .map((provider) => (
                        <SelectGroup key={provider.id}>
                          <SelectLabel>{provider.name}</SelectLabel>
                          {provider.models.map((model) => (
                            <SelectItem key={model.id} value={model.id} className="touch-target">
                              {model.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          )}
        </>
      )}
      {!adding && (settings || error) && feedback}
    </FieldGroup>
  );
}
