import { Button } from '@workspace/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { ChevronDown, FolderOpen, FolderPlus } from 'lucide-react';
import type { Workspace } from '../../workspaces/contract.js';
import { workspaceLabel } from './workspace-label.js';

export function WorkspacePicker({
  workspaces,
  selected,
  disabled,
  open,
  onOpenChange,
  onSelect,
  onAdd,
}: {
  workspaces: readonly Workspace[];
  selected?: Workspace;
  disabled?: boolean;
  open: boolean;
  onOpenChange(this: void, open: boolean): void;
  onSelect(this: void, id: string): void;
  onAdd(this: void): void;
}) {
  const label = selected ? workspaceLabel(selected, workspaces) : 'Choose workspace';
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="touch-target min-w-0 shrink" />}
        aria-label="Choose workspace"
        aria-description={selected ? label : undefined}
        disabled={disabled}
      >
        <FolderOpen />
        <span className="truncate">{label}</span>
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto max-w-[calc(100vw-2rem)] min-w-48">
        <DropdownMenuRadioGroup value={selected?.id ?? ''} onValueChange={onSelect}>
          {workspaces.map((workspace) => (
            <DropdownMenuRadioItem
              key={workspace.id}
              value={workspace.id}
              closeOnClick
              className="touch-target"
            >
              <FolderOpen />
              <span className="break-words">{workspaceLabel(workspace, workspaces)}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="touch-target" onClick={onAdd}>
          <FolderPlus /> Add workspace…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
