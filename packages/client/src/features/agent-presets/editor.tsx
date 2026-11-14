import type { AgentPreset, AgentPresetInput } from '@workspace/protocol/host';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { Spinner } from '@workspace/ui/components/spinner';
import { Textarea } from '@workspace/ui/components/textarea';
import { ArrowLeft, Check, Plus } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AgentPresetsClient } from './contract.js';

const blankPreset: AgentPresetInput = {
  name: '',
  description: '',
  instructions: '',
  capabilities: [],
};

function draftFromPreset(preset: AgentPreset): AgentPresetInput {
  const { name, description, instructions, capabilities } = preset;
  return { name, description, instructions, capabilities };
}

export function AgentPresetEditor({ client }: { client: AgentPresetsClient }) {
  const catalog = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const id = useId();
  const [original, setOriginal] = useState<AgentPreset>();
  const [draft, setDraft] = useState(blankPreset);
  const [editorOpen, setEditorOpen] = useState(false);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const editorNameRef = useRef<HTMLInputElement>(null);
  const returnFocusIdRef = useRef<string | undefined>(undefined);
  const moveFocusRef = useRef(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);

  useEffect(() => {
    void client.refresh().catch(() => setError('Could not refresh agent presets.'));
  }, [client]);

  useLayoutEffect(() => {
    if (!moveFocusRef.current) {
      return;
    }
    moveFocusRef.current = false;
    if (editorOpen) {
      editorNameRef.current?.focus();
    } else {
      const opener = returnFocusIdRef.current && document.getElementById(returnFocusIdRef.current);
      (opener || listButtonRef.current)?.focus();
    }
  }, [editorOpen]);

  function edit(preset?: AgentPreset) {
    returnFocusIdRef.current = preset && id + '-edit-' + preset.id;
    moveFocusRef.current = true;
    setEditorOpen(true);
    if (preset?.id === original?.id) {
      return;
    }
    setOriginal(preset);
    setDraft(preset ? draftFromPreset(preset) : blankPreset);
    setQuery('');
    setError('');
    setStatus('');
  }

  function duplicatePreset() {
    setOriginal(undefined);
    setDraft({ ...draft, name: `Copy of ${draft.name}`.slice(0, 80) });
    setError('');
    setStatus('');
  }

  function toggleCapability(id: string) {
    const selected = draft.capabilities.includes(id);
    const capabilities = selected
      ? draft.capabilities.filter((item) => item !== id)
      : [...draft.capabilities, id];
    setStatus('');
    setDraft({ ...draft, capabilities });
  }

  const capabilities = [
    ...catalog.capabilities,
    ...draft.capabilities
      .filter((id) => !catalog.capabilities.some((item) => item.id === id))
      .map((id) => ({
        id,
        name: id,
        description: 'Unavailable. Remove to save this preset.',
      })),
  ];
  const selectedCapabilities = capabilities.filter(({ id }) => draft.capabilities.includes(id));
  const searchTerm = query.trim().toLowerCase();
  const availableCapabilities = capabilities.filter(
    ({ id, name, description }) =>
      !draft.capabilities.includes(id) &&
      `${name} ${description} ${id}`.toLowerCase().includes(searchTerm),
  );
  const visible = [...selectedCapabilities, ...availableCapabilities];

  async function save() {
    if (saving) {
      return;
    }
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const saved = await client.save(draft, original);
      setOriginal(saved);
      setStatus('Preset saved.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the agent preset.');
    } finally {
      setSaving(false);
    }
  }

  async function setDefault(presetId: string) {
    setSettingDefault(true);
    setError('');
    setStatus('');
    try {
      await client.setDefault(presetId);
      setStatus('Default agent preset saved.');
    } catch {
      setError('Could not save the default agent preset.');
    } finally {
      setSettingDefault(false);
    }
  }

  if (!editorOpen) {
    const newDraft =
      !original &&
      Boolean(draft.name || draft.description || draft.instructions || draft.capabilities.length);
    return (
      <FieldGroup>
        {catalog.presets.length > 0 && (
          <Field orientation="responsive">
            <FieldLabel htmlFor={id + '-default'}>Default for new chats</FieldLabel>
            <Select
              value={catalog.defaultPresetId}
              disabled={settingDefault}
              onValueChange={(value) => {
                if (value && value !== catalog.defaultPresetId) {
                  void setDefault(value);
                }
              }}
            >
              <SelectTrigger id={id + '-default'} className="touch-target min-w-0">
                <SelectValue placeholder="Choose an agent preset">
                  {catalog.presets.find(({ id }) => id === catalog.defaultPresetId)?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                <SelectGroup>
                  {catalog.presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id} className="touch-target">
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        )}
        <Button
          ref={listButtonRef}
          type="button"
          variant="outline"
          className="touch-target w-full"
          onClick={() => edit()}
        >
          <Plus data-icon="inline-start" /> {newDraft ? 'Resume new preset' : 'New preset'}
        </Button>
        {catalog.presets.length ? (
          <ul className="divide-y">
            {catalog.presets.map((preset) => (
              <li key={preset.id} className="py-3 first:pt-0 last:pb-0">
                <Field orientation="responsive">
                  <FieldContent>
                    <div className="flex flex-wrap items-center gap-2">
                      <FieldTitle>{preset.name}</FieldTitle>
                      {preset.id === catalog.defaultPresetId && (
                        <Badge variant="secondary">Default for new chats</Badge>
                      )}
                    </div>
                    {preset.description && (
                      <FieldDescription>{preset.description}</FieldDescription>
                    )}
                  </FieldContent>
                  <Button
                    id={id + '-edit-' + preset.id}
                    type="button"
                    variant="outline"
                    className="touch-target"
                    aria-label={`Edit ${preset.name}`}
                    onClick={() => edit(preset)}
                  >
                    Edit
                  </Button>
                </Field>
              </li>
            ))}
          </ul>
        ) : (
          <FieldDescription>No agent presets yet.</FieldDescription>
        )}
        <FieldError>{error}</FieldError>
        <span role="status" className="sr-only">
          {status}
        </span>
      </FieldGroup>
    );
  }

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      onChange={() => setStatus('')}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={saving} className="min-w-0">
        <FieldGroup>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              className="touch-target"
              onClick={() => {
                moveFocusRef.current = true;
                setEditorOpen(false);
              }}
            >
              <ArrowLeft data-icon="inline-start" /> All presets
            </Button>
            {original && (
              <Button
                type="button"
                variant="outline"
                className="touch-target"
                onClick={duplicatePreset}
              >
                Duplicate
              </Button>
            )}
          </div>
          <FieldTitle>{original ? `Edit ${original.name}` : 'New preset'}</FieldTitle>
          <Field>
            <FieldLabel htmlFor={id + '-name'}>Name</FieldLabel>
            <Input
              ref={editorNameRef}
              id={id + '-name'}
              required
              maxLength={80}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={id + '-description'}>Description</FieldLabel>
            <Input
              id={id + '-description'}
              maxLength={240}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={id + '-instructions'}>Instructions</FieldLabel>
            <Textarea
              id={id + '-instructions'}
              required
              maxLength={12000}
              value={draft.instructions}
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
            />
          </Field>
          <FieldSet className="min-w-0 gap-2">
            <FieldLegend>Capabilities ({draft.capabilities.length} selected)</FieldLegend>
            <Input
              aria-label="Search capabilities"
              placeholder="Search capabilities"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <ul className="flex flex-col gap-2">
              {visible.map((capability) => {
                const selected = draft.capabilities.includes(capability.id);
                return (
                  <li key={capability.id} className="rounded-lg border p-2">
                    <Button
                      type="button"
                      aria-pressed={selected}
                      variant={selected ? 'secondary' : 'outline'}
                      className="touch-target w-full justify-start"
                      onClick={() => toggleCapability(capability.id)}
                    >
                      {selected ? (
                        <Check data-icon="inline-start" />
                      ) : (
                        <Plus data-icon="inline-start" />
                      )}
                      <span className="truncate">{capability.name}</span>
                    </Button>
                    <p className="mt-1 text-xs text-muted-foreground">{capability.description}</p>
                  </li>
                );
              })}
            </ul>
            {!visible.length && (
              <p className="text-sm text-muted-foreground">No matching capabilities.</p>
            )}
          </FieldSet>
        </FieldGroup>
      </fieldset>
      <FieldGroup>
        <FieldSeparator />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <FieldError>{error}</FieldError>
            <FieldDescription role="status">{saving ? 'Saving preset…' : status}</FieldDescription>
          </div>
          <Button type="submit" className="touch-target" disabled={saving} focusableWhenDisabled>
            {saving && <Spinner data-icon="inline-start" />}
            Save preset
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
