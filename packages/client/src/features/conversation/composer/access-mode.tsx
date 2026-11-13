import { type AccessMode as AccessModeId, accessModeSchema } from '@workspace/protocol/host';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Field, FieldLabel } from '@workspace/ui/components/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { ToolbarSelect } from '@workspace/ui/components/toolbar-select';
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useId, useRef, useState } from 'react';

export const previewAccessModes = ['read-only', 'workspace-write', 'full-access'] as const;
const labels: Record<AccessModeId, string> = {
  'read-only': 'Read only',
  'workspace-write': 'Workspace write',
  'full-access': 'Full access',
};

const label = (mode: string) => {
  const result = accessModeSchema.safeParse(mode);
  return result.success ? labels[result.data] : mode;
};

const icons = {
  'read-only': Shield,
  'workspace-write': ShieldCheck,
  'full-access': ShieldAlert,
} satisfies Record<AccessModeId, typeof Shield>;

function AccessModeLabel({ mode }: { mode: AccessModeId }) {
  return <span className={mode === 'full-access' ? 'text-warning' : undefined}>{label(mode)}</span>;
}

function AccessModeIcon({ mode }: { mode: AccessModeId }) {
  const Icon = icons[mode];
  return (
    <Icon aria-hidden="true" className={mode === 'full-access' ? 'stroke-warning' : undefined} />
  );
}

export function AccessMode({
  mobile,
  value,
  options,
  onChange,
  preview,
  disabled,
}: {
  mobile: boolean;
  value: AccessModeId;
  options: readonly AccessModeId[];
  onChange(this: void, mode: AccessModeId): void | Promise<void>;
  preview?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);

  const description = (option: AccessModeId) => {
    const prefix = preview ? 'Preview · ' : '';
    if (option === 'read-only') {
      return prefix + 'Block file changes and shell commands.';
    }
    if (option === 'workspace-write') {
      return prefix + 'Create and edit files inside the selected workspace.';
    }
    return prefix + 'Run commands with Host access, including files outside the workspace.';
  };

  const renderOption = (option: AccessModeId) => (
    <span className="flex items-start gap-2 whitespace-normal">
      <AccessModeIcon mode={option} />
      <span className="flex min-w-0 flex-col">
        <AccessModeLabel mode={option} />
        <span className="text-xs text-muted-foreground">{description(option)}</span>
      </span>
    </span>
  );

  const choose = (next: string) => {
    const mode = options.find((option) => option === next);
    if (!mode || mode === value || disabled) {
      return;
    }
    if (mode === 'full-access') {
      setConfirming(true);
    } else {
      void onChange(mode);
    }
  };

  return (
    <>
      {mobile ? (
        <Field>
          <FieldLabel htmlFor={id}>Access mode</FieldLabel>
          <Select
            value={value}
            disabled={disabled}
            onValueChange={(next) => next !== null && choose(next)}
          >
            <SelectTrigger
              ref={triggerRef}
              id={id}
              aria-label="Access mode"
              className="touch-target w-full"
            >
              <span className="flex min-w-0 items-center gap-2">
                <AccessModeIcon mode={value} />
                <SelectValue>
                  <AccessModeLabel mode={value} />
                </SelectValue>
              </span>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {options.map((option) => (
                  <SelectItem
                    key={option}
                    value={option}
                    label={label(option)}
                    className="touch-target"
                  >
                    {renderOption(option)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : (
        <ToolbarSelect
          label="Access mode"
          value={value}
          options={options}
          getLabel={label}
          renderOption={(option) => {
            const mode = options.find((mode) => mode === option);
            return mode ? renderOption(mode) : option;
          }}
          renderValue={() => <AccessModeLabel mode={value} />}
          disabled={disabled}
          onChange={choose}
          triggerRef={triggerRef}
        >
          <AccessModeIcon mode={value} />
        </ToolbarSelect>
      )}
      {options.includes('full-access') && (
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogContent showCloseButton={false} initialFocus={cancelRef} finalFocus={triggerRef}>
            <DialogHeader>
              <DialogTitle>{preview ? 'Preview Full access?' : 'Enable Full access?'}</DialogTitle>
              <DialogDescription>
                Full access lets this agent run commands with the Host account’s permissions,
                including reading, changing, and deleting files outside the workspace.
                {preview
                  ? ' This preview does not change Host permissions.'
                  : ' This grant stays with this conversation, even after the Host restarts.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose
                render={
                  <Button
                    type="button"
                    ref={cancelRef}
                    variant="outline"
                    className="touch-target"
                  />
                }
              >
                Cancel
              </DialogClose>
              <DialogClose
                render={
                  <Button
                    type="button"
                    className="touch-target"
                    onClick={() => void onChange('full-access')}
                  />
                }
              >
                {preview ? 'Preview Full access' : 'Enable Full access'}
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
