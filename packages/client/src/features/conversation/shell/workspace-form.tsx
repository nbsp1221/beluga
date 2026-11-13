import type { WorkspaceFolders } from '@workspace/protocol/host';
import { Button } from '@workspace/ui/components/button';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@workspace/ui/components/dialog';
import { Field, FieldError, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { ShellButton } from '@workspace/ui/components/shell-button';
import { ArrowUp, Folder, FolderPlus, X } from 'lucide-react';
import { type Dispatch, type SetStateAction, useEffect, useId, useRef, useState } from 'react';
import type { WorkspaceClient } from '../../workspaces/contract.js';

export function WorkspaceStart() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-6 text-center">
      <h2 className="text-xl font-medium text-balance">Add a workspace to start</h2>
      <DialogTrigger render={<Button className="touch-target" />}>
        <FolderPlus />
        Add workspace
      </DialogTrigger>
    </div>
  );
}

export function WorkspaceDialogContent({
  client,
  mobile,
  open,
  onAdded,
}: {
  client: WorkspaceClient;
  mobile: boolean;
  open: boolean;
  onAdded(this: void, id: string): void | Promise<void>;
}) {
  const [value, setValue] = useState('');
  return (
    <DialogContent showCloseButton={!mobile} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <DialogTitle>Add workspace</DialogTitle>
        {mobile && (
          <DialogClose render={<ShellButton label="Close workspace form" size="icon" />}>
            <X />
          </DialogClose>
        )}
      </div>
      <DialogDescription>
        {client.browseWorkspaceFolders
          ? 'Choose a project folder on the Host.'
          : 'Organize your conversations in a workspace.'}
      </DialogDescription>
      {open && (
        <WorkspaceForm
          client={client}
          value={value}
          setValue={setValue}
          onAdded={async (id) => {
            await onAdded(id);
            setValue('');
          }}
        />
      )}
    </DialogContent>
  );
}

function WorkspaceForm({
  client,
  value,
  setValue,
  onAdded,
}: {
  client: WorkspaceClient;
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  onAdded(this: void, id: string): Promise<void>;
}) {
  const browse = client.browseWorkspaceFolders;
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const folderListRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState<{ path?: string }>(() => (value ? { path: value } : {}));
  const [result, setResult] = useState<{
    query: typeof query;
    folders: WorkspaceFolders;
  }>();
  const [browseError, setBrowseError] = useState<{
    query: typeof query;
    message: string;
  }>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const listing = result?.query === query ? result.folders : undefined;
  const message = browseError?.query === query ? browseError.message : undefined;

  useEffect(() => {
    if (!browse) {
      return;
    }
    let active = true;
    void browse(query.path).then(
      (folders) => {
        if (!active) {
          return;
        }
        setResult({ query, folders });
        setValue((current) => (current === (query.path ?? '') ? folders.path : current));
      },
      (reason: unknown) => {
        if (!active) {
          return;
        }
        setBrowseError({
          query,
          message: reason instanceof Error ? reason.message : 'Could not open this folder.',
        });
      },
    );
    return () => {
      active = false;
    };
  }, [browse, query, setValue]);

  const open = (path: string, focusFolders = false) => {
    setValue(path);
    setError('');
    setQuery({ path });
    if (focusFolders) {
      folderListRef.current?.focus({ preventScroll: true });
    }
  };

  const submit = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onAdded(await client.addWorkspace(value));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add the workspace.');
      setSaving(false);
      inputRef.current?.focus();
    }
  };

  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor={inputId}>{browse ? 'Host folder path' : 'Workspace name'}</FieldLabel>
        <div className="flex min-w-0 items-center gap-2">
          <Input
            ref={inputRef}
            className="touch-target min-w-0"
            id={inputId}
            required
            autoFocus={!browse}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError('');
            }}
            placeholder={browse ? 'Absolute folder path' : 'my-project'}
          />
          {browse && (
            <Button
              type="button"
              variant="outline"
              className="touch-target"
              disabled={!value || saving}
              onClick={() => open(value)}
            >
              Open
            </Button>
          )}
        </div>
        <FieldError id={errorId}>{error}</FieldError>
      </Field>
      {browse && (
        <div className="flex min-w-0 flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            className="touch-target self-start"
            disabled={!listing?.parent || saving}
            onClick={() => listing?.parent && open(listing.parent, true)}
          >
            <ArrowUp /> Parent folder
          </Button>
          <div
            ref={folderListRef}
            aria-label="Host folders"
            aria-busy={!listing && !message}
            role="group"
            tabIndex={-1}
            className="max-h-[min(12rem,30dvh)] overflow-y-auto overscroll-contain rounded-lg border p-1"
          >
            {listing?.folders.map((folder) => (
              <Button
                type="button"
                variant="ghost"
                className="touch-target w-full justify-start"
                key={folder.path}
                disabled={saving}
                onClick={() => open(folder.path, true)}
              >
                <Folder />
                <span className="truncate">{folder.name}</span>
              </Button>
            ))}
            {!listing?.folders.length && (
              <p role="status" className="p-2 text-sm text-muted-foreground">
                {message ?? (listing ? 'No subfolders.' : 'Loading folders…')}
              </p>
            )}
          </div>
        </div>
      )}
      <Button type="submit" disabled={saving} className="touch-target self-end">
        Add workspace
      </Button>
    </form>
  );
}
