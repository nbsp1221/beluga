import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@workspace/ui/components/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { ShellButton } from '@workspace/ui/components/shell-button';
import { Spinner } from '@workspace/ui/components/spinner';
import { sidebarLinkClassName } from '@workspace/ui/lib/sidebar-link';
import { cn } from '@workspace/ui/lib/utils';
import {
  Archive,
  ChevronRight,
  Copy,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  GitFork,
  Hash,
  Link2,
  List,
  Pencil,
  Pin,
  SquareArrowOutUpRight,
} from 'lucide-react';
import { useRef } from 'react';
import { Link } from 'react-router';
import { type Session, sessionTitle } from '../contract.js';

export function SessionRow({
  session,
  current,
  running,
  unread,
  workspace,
  nested,
  onClick,
}: {
  session: Session;
  current: boolean;
  running: boolean;
  unread: boolean;
  workspace?: string;
  nested?: boolean;
  onClick: () => void;
}) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const title = sessionTitle(session);
  const status = running ? 'Running' : unread ? 'Unread response' : undefined;
  const linkClassName = cn(
    'flex min-h-12 items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-sm focus-visible:outline-sidebar-ring aria-[current=page]:font-medium md:min-h-8',
    nested && 'ps-8',
  );
  const link = (
    <Link
      ref={linkRef}
      to={`/chat/${session.id}`}
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
      className={
        session.isDraft ? sidebarLinkClassName(linkClassName) : `min-w-0 flex-1 ${linkClassName}`
      }
    >
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {workspace && (
        <span className="max-w-1/3 shrink-0 truncate text-xs text-muted-foreground">
          {workspace}
        </span>
      )}
      {status && <span className="sr-only">{status}</span>}
    </Link>
  );

  if (session.isDraft) {
    return link;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="group/session flex items-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground has-focus-visible:bg-sidebar-accent has-aria-[current=page]:bg-sidebar-accent has-aria-[current=page]:text-sidebar-accent-foreground has-data-popup-open:bg-sidebar-accent data-popup-open:bg-sidebar-accent">
        {link}
        <div className="grid shrink-0 grid-flow-col items-center">
          <span
            aria-hidden="true"
            className="row-start-1 grid size-4 place-items-center justify-self-center group-hover/session:invisible [@media(hover:hover)]:col-start-1 [@media(hover:hover)]:group-has-focus-visible/session:invisible [@media(hover:hover)]:group-has-data-popup-open/session:invisible [@media(hover:hover)]:group-data-popup-open/session:invisible"
          >
            {running ? (
              <Spinner className="size-3 motion-reduce:animate-none" />
            ) : (
              unread && <span className="size-1.5 rounded-full bg-primary" />
            )}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <ShellButton
                  label={`Actions for ${title}`}
                  className="row-start-1 text-muted-foreground transition-colors group-hover/session:opacity-100 group-has-focus-visible/session:opacity-100 group-data-popup-open/session:opacity-100 data-popup-open:opacity-100 [@media(hover:hover)]:col-start-1 [@media(hover:hover)]:opacity-0"
                />
              }
            >
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label="Session actions" className="w-52">
              <SessionMenuItems unread={unread} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label="Session actions" className="w-52" finalFocus={linkRef}>
        <SessionMenuItems unread={unread} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Base UI exposes the same item and submenu primitives in both menu roots.
function SessionMenuItems({ unread }: { unread: boolean }) {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem className="touch-target" disabled>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem className="touch-target" disabled>
          <Pin />
          Pin
        </DropdownMenuItem>
        <DropdownMenuItem className="touch-target" disabled>
          {unread ? <Eye /> : <EyeOff />}
          {unread ? 'Mark as read' : 'Mark as unread'}
        </DropdownMenuItem>
        <DropdownMenuItem className="touch-target" disabled>
          <List />
          Move to section
          <ChevronRight className="ms-auto" />
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem className="touch-target" disabled>
          <GitFork />
          Branch chat
        </DropdownMenuItem>
        <DropdownMenuItem className="touch-target" disabled>
          <SquareArrowOutUpRight />
          Open in new tab
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="touch-target">
            <Copy />
            Copy
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuGroup>
              <DropdownMenuItem className="touch-target" disabled>
                <Link2 />
                Chat link
              </DropdownMenuItem>
              <DropdownMenuItem className="touch-target" disabled>
                <Hash />
                Session ID
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem className="touch-target" disabled>
          <Download />
          Export chat
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem className="touch-target" disabled>
          <Archive />
          Archive
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
