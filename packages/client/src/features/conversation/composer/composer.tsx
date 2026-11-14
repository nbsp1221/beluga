import type {
  AccessMode as AccessModeId,
  ModelOption,
  RunSettings,
} from '@workspace/protocol/host';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentTitle,
} from '@workspace/ui/components/attachment';
import { Button } from '@workspace/ui/components/button';
import { Field, FieldError, FieldLabel } from '@workspace/ui/components/field';
import { InputGroup, InputGroupTextarea } from '@workspace/ui/components/input-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@workspace/ui/components/sheet';
import { ShellButton } from '@workspace/ui/components/shell-button';
import { Spinner } from '@workspace/ui/components/spinner';
import { ArrowUp, Plus, SlidersHorizontal, Square, X } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';
import type { ConversationClient, Session } from '../contract.js';
import { useLayout } from '../../../workbench/contract.js';
import { AccessMode, previewAccessModes } from './access-mode.js';
import { ModelMenu, effortLabels } from './model-menu.js';

const editorInset = 'px-1.5 py-1.5';

export function Composer({
  client,
  session,
  mode,
  blocked,
  workspacePicker,
  accessModes,
  models,
  defaultModel,
  onModeChange,
}: {
  client: ConversationClient;
  session: Session;
  mode: string;
  blocked: boolean;
  workspacePicker?: {
    open: boolean;
    onOpen(this: void): void;
  };
  accessModes: readonly AccessModeId[];
  models?: readonly ModelOption[];
  defaultModel?: string | null;
  onModeChange(this: void, mode: string): void;
}) {
  const { mobile, viewportHeight } = useLayout();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<readonly string[]>([]);

  const savedSettings = session.runSettings;
  const preferredModel = models?.find(({ id }) => id === defaultModel);
  const selectedModel = savedSettings
    ? models?.find(
        (item) =>
          item.id === savedSettings.model &&
          (savedSettings.effort === 'default' || item.efforts.includes(savedSettings.effort)),
      )
    : preferredModel;
  const model = selectedModel ?? preferredModel ?? models?.[0];
  const needsModel = client.mode === 'connected' && !selectedModel;
  const effort = selectedModel ? (savedSettings?.effort ?? 'default') : 'default';
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  const changeRunSettings = async (settings: RunSettings) => {
    if (settingsSaving || (selectedModel?.id === settings.model && effort === settings.effort)) {
      return;
    }

    setSettingsSaving(true);
    setSettingsError('');
    try {
      await client.setRunSettings?.(session.id, settings);
    } catch (reason) {
      setSettingsError(
        reason instanceof Error ? reason.message : 'Could not update model settings.',
      );
    } finally {
      setSettingsSaving(false);
    }
  };

  const [previewAccess, setPreviewAccess] = useState<AccessModeId>('workspace-write');
  const [accessSaving, setAccessSaving] = useState(false);

  const changeAccessMode = async (mode: AccessModeId) => {
    setAccessSaving(true);
    setSettingsError('');
    try {
      await client.setAccessMode?.(session.id, mode);
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : 'Could not update access mode.');
    } finally {
      setAccessSaving(false);
    }
  };

  const preview = client.mode === 'demo';
  const accessMode = preview ? (
    <AccessMode
      mobile={mobile}
      value={previewAccess}
      options={previewAccessModes}
      onChange={setPreviewAccess}
      preview
    />
  ) : accessModes.length > 0 ? (
    <AccessMode
      mobile={mobile}
      value={
        session.accessMode && accessModes.includes(session.accessMode)
          ? session.accessMode
          : 'read-only'
      }
      options={accessModes}
      disabled={accessSaving || Boolean(session.savingDraft)}
      onChange={changeAccessMode}
    />
  ) : null;

  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const submissionId = session.activeSubmissionId;
  const stopRun = client.stop;
  const canStop = Boolean(stopRun && submissionId);
  const sendingBlocked = blocked || settingsSaving || accessSaving || needsModel;
  const showStopAction = canStop || stopping;
  const showProgress = stopping || (submitting && !canStop);

  const stop = async () => {
    if (!stopRun || !submissionId || stopping) {
      return;
    }

    setStopping(true);
    setError('');
    try {
      await stopRun(session.id, submissionId);
    } catch {
      setError('Could not stop the response. Try again.');
    } finally {
      setStopping(false);
    }
  };

  const send = async () => {
    if (submitting || showStopAction || sendingBlocked) {
      return;
    }
    if (!session.draft.trim()) {
      setError('Write a message before sending.');
      editorRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await client.send(session.id, { mode, attachments });
      setAttachments([]);
    } catch (error) {
      setError(
        error instanceof Error && session.isDraft
          ? error.message
          : 'Unable to send this message. Try again.',
      );
    } finally {
      setSubmitting(false);
      editorRef.current?.focus();
    }
  };

  return (
    <form
      className="@container w-full"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <InputGroup
        aria-label="Message composer"
        className="h-auto flex-col gap-2 rounded-3xl border-border bg-card p-2 text-card-foreground dark:bg-card forced-colors:has-[[data-slot=input-group-control]:focus-visible]:not-has-[[aria-invalid=true]]:outline-2 forced-colors:has-[[data-slot=input-group-control]:focus-visible]:not-has-[[aria-invalid=true]]:outline-[Highlight] forced-colors:has-[[data-slot=input-group-control]:focus-visible]:not-has-[[aria-invalid=true]]:outline-solid"
        data-testid="composer-card"
      >
        {attachments.length > 0 && (
          <ComposerAttachments
            attachments={attachments}
            mobile={mobile}
            onRemove={(name) => {
              setAttachments((current) => current.filter((value) => value !== name));
              editorRef.current?.focus();
            }}
          />
        )}
        {workspacePicker ? (
          <Button
            type="button"
            variant="ghost"
            aria-haspopup="menu"
            aria-expanded={workspacePicker.open}
            className={`min-h-14 w-full items-start justify-start text-base font-normal text-muted-foreground md:text-sm ${editorInset}`}
            onClick={workspacePicker.onOpen}
          >
            Choose a workspace to start
          </Button>
        ) : (
          <InputGroupTextarea
            ref={editorRef}
            aria-label="Message"
            aria-describedby={error ? 'message-error' : undefined}
            aria-invalid={Boolean(error)}
            className={`max-h-[min(20rem,25dvh)] min-h-14 md:max-h-80 ${editorInset}`}
            style={
              viewportHeight === undefined
                ? undefined
                : { maxHeight: `min(20rem, ${viewportHeight / 4}px)` }
            }
            placeholder="Describe what you want to build…"
            enterKeyHint={mobile ? 'enter' : 'send'}
            value={session.draft}
            onChange={(event) => {
              client.setDraft(session.id, event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                !mobile
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
        )}
        <div className="flex w-full flex-wrap items-center justify-between gap-2 text-foreground">
          <div className="flex min-w-0 items-center gap-1">
            <ShellButton label="Attach files" onClick={() => fileInputRef.current?.click()}>
              <Plus />
            </ShellButton>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                setAttachments((current) => [
                  ...new Set([
                    ...current,
                    ...Array.from(event.target.files ?? [], (file) => file.name),
                  ]),
                ]);
                event.target.value = '';
              }}
            />
            {!mobile && accessMode}
            {mobile && (
              <MobileComposerSettings
                preview={preview}
                mode={mode}
                onModeChange={onModeChange}
                accessMode={accessMode}
                model={model}
                models={models}
                selectedModel={selectedModel}
                effort={effort}
                disabled={settingsSaving || session.savingDraft}
                onRunSettings={changeRunSettings}
              />
            )}
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {!mobile && model && models && (
              <ModelMenu
                models={models}
                model={model}
                effort={effort}
                unavailable={needsModel}
                disabled={settingsSaving || Boolean(session.savingDraft)}
                onChange={(settings) => void changeRunSettings(settings)}
              />
            )}
            <ShellButton
              label={
                stopping
                  ? 'Stopping response'
                  : canStop
                    ? 'Stop response'
                    : submitting
                      ? 'Sending message'
                      : 'Send message'
              }
              size="icon-lg"
              variant={showStopAction ? 'secondary' : 'default'}
              className="rounded-full"
              focusableWhenDisabled={submitting || stopping}
              disabled={stopping || (!canStop && (submitting || sendingBlocked))}
              type={showStopAction ? 'button' : 'submit'}
              onClick={canStop ? () => void stop() : undefined}
            >
              {showProgress ? (
                <Spinner aria-hidden="true" className="motion-reduce:animate-none" />
              ) : canStop ? (
                <Square aria-hidden="true" className="fill-current" />
              ) : (
                <ArrowUp />
              )}
            </ShellButton>
          </div>
        </div>
      </InputGroup>
      <ComposerFeedback
        error={error}
        needsProvider={needsModel && !model}
        settingsError={settingsError}
      />
    </form>
  );
}

function ComposerFeedback({
  error,
  needsProvider,
  settingsError,
}: {
  error: string;
  needsProvider: boolean;
  settingsError: string;
}) {
  return (
    <>
      <FieldError id="message-error" className="px-3">
        {error}
      </FieldError>
      {needsProvider && (
        <p className="px-3 text-sm text-muted-foreground">
          Connect a provider in Settings → Providers to start chatting.
        </p>
      )}
      {settingsError && (
        <p role="alert" className="px-3 text-sm text-destructive">
          {settingsError}
        </p>
      )}
    </>
  );
}

function ComposerAttachments({
  attachments,
  mobile,
  onRemove,
}: {
  attachments: readonly string[];
  mobile: boolean;
  onRemove: (name: string) => void;
}) {
  const attachmentItems = attachments.map((name) => (
    <Attachment key={name} size="xs" aria-label={`Attached file name: ${name}`}>
      <AttachmentContent>
        <AttachmentTitle>{name}</AttachmentTitle>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction
          className="touch-target"
          aria-label={`Remove ${name}`}
          onClick={() => onRemove(name)}
        >
          <X />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  ));
  return (
    <div className="flex w-full flex-wrap gap-2 px-1.5">
      {mobile ? (
        <AttachmentGroup className="w-full">{attachmentItems}</AttachmentGroup>
      ) : (
        attachmentItems
      )}
    </div>
  );
}

function MobileComposerSettings({
  preview,
  mode,
  onModeChange,
  accessMode,
  model,
  models,
  selectedModel,
  effort,
  disabled,
  onRunSettings,
}: {
  preview: boolean;
  mode: string;
  onModeChange: (mode: string) => void;
  accessMode: ReactNode;
  model?: ModelOption;
  models?: readonly ModelOption[];
  selectedModel?: ModelOption;
  effort: RunSettings['effort'];
  disabled?: boolean;
  onRunSettings: (settings: RunSettings) => Promise<void>;
}) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" className="touch-target" aria-label="Conversation settings" />
        }
      >
        <SlidersHorizontal /> Settings
      </SheetTrigger>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-h-dvh overflow-y-auto pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader className="flex-row items-center justify-between gap-2">
          <SheetTitle>Conversation settings</SheetTitle>
          <SheetClose render={<ShellButton label="Close settings" size="icon" />}>
            <X />
          </SheetClose>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {preview && (
            <MobileSelect
              label="Agent mode"
              value={mode}
              options={['Standard mode', 'Plan mode']}
              onChange={onModeChange}
            />
          )}
          {accessMode}
          {model && models && (
            <>
              <MobileSelect
                label="Model"
                value={selectedModel?.id ?? ''}
                options={models.map(({ id }) => id)}
                getLabel={(id) => {
                  const option = models.find((item) => item.id === id);
                  return option ? `${option.name} · ${option.providerName}` : 'Choose model';
                }}
                disabled={disabled}
                onChange={(id) =>
                  void onRunSettings({
                    model: id,
                    effort: 'default',
                  })
                }
              />
              {selectedModel && model.efforts.length > 0 && (
                <MobileSelect
                  label="Effort"
                  value={effort}
                  options={['default', ...model.efforts]}
                  getLabel={(value) => effortLabels[value]}
                  disabled={disabled}
                  onChange={(value) =>
                    void onRunSettings({
                      model: model.id,
                      effort: value,
                    })
                  }
                />
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MobileSelect<Value extends string>({
  label,
  value,
  options,
  getLabel = (value) => value,
  disabled,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly Value[];
  getLabel?(this: void, value: Value): string;
  disabled?: boolean;
  onChange(this: void, value: Value): void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) {
            onChange(next);
          }
        }}
      >
        <SelectTrigger id={id} aria-label={label} className="touch-target w-full">
          <SelectValue>{getLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option} value={option} className="touch-target">
                {getLabel(option)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
