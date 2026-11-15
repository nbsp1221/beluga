import { Button } from '@workspace/ui/components/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible';
import { Dialog, DialogTrigger } from '@workspace/ui/components/dialog';
import { DisclosureButton } from '@workspace/ui/components/disclosure-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { Input } from '@workspace/ui/components/input';
import { ShellButton } from '@workspace/ui/components/shell-button';
import { sidebarLinkClassName } from '@workspace/ui/lib/sidebar-link';
import {
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  MessageCirclePlus,
  PanelLeft,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { WorkspaceClient } from '../../workspaces/contract.js';
import { useLayout } from '../../../workbench/contract.js';
import { type ConversationClient, type Session, sessionTitle } from '../contract.js';
import { WorkspaceDialogContent, WorkspaceStart } from './workspace-form.js';
import { workspaceLabel } from './workspace-label.js';

export function ConversationSidebar({
  client,
  workspaceClient,
}: {
  client: ConversationClient;
  workspaceClient: WorkspaceClient;
}) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const workspaces = useSyncExternalStore(workspaceClient.subscribe, workspaceClient.getSnapshot);
  const { mobile, drawer, toggleSidebar, closeDrawer } = useLayout();
  const navigate = useNavigate();
  const sessionId = useLocation().pathname.split('/')[2] || client.initialSessionId || 'welcome';

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const restoreSearchFocusRef = useRef(false);

  const closeSearch = () => {
    restoreSearchFocusRef.current = true;
    setSearching(false);
    setQuery('');
  };

  useLayoutEffect(() => {
    if (!searching && restoreSearchFocusRef.current) {
      restoreSearchFocusRef.current = false;
      searchButtonRef.current?.focus();
    }
  }, [searching]);

  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [searchFolded, setSearchFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [sortByName, setSortByName] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sessionError, setSessionError] = useState('');

  const create = async (
    workspaceId = snapshot.sessions.find((session) => session.id === sessionId)?.workspaceId ??
      (client.mode === 'demo' ? (workspaces[0]?.id ?? null) : null),
  ) => {
    setSessionError('');
    await navigate(`/chat/${await client.createSession(workspaceId)}`);
    closeDrawer();
  };

  const searchTerm = query.toLowerCase();

  const toggleGroup = (id: string) =>
    (searchTerm ? setSearchFolded : setFolded)((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const sessionsByWorkspace = useMemo(() => {
    const matches = snapshot.sessions.filter(
      (session) => !session.isDraft && sessionTitle(session).toLowerCase().includes(searchTerm),
    );
    if (sortByName) {
      matches.sort((a, b) => sessionTitle(a).localeCompare(sessionTitle(b)));
    }
    const groups = new Map<Session['workspaceId'], Session[]>();
    for (const session of matches) {
      const group = groups.get(session.workspaceId);
      if (group) {
        group.push(session);
      } else {
        groups.set(session.workspaceId, [session]);
      }
    }
    return groups;
  }, [snapshot.sessions, searchTerm, sortByName]);

  return (
    <Dialog open={adding} onOpenChange={setAdding}>
      <div className="flex h-full min-h-0 flex-col gap-2 p-2">
        <div className="flex min-h-14 shrink-0 items-center justify-between gap-2">
          {mobile ? (
            <h1 className="truncate text-xl font-semibold">Chats</h1>
          ) : (
            <span className="truncate text-xl font-semibold">Beluga</span>
          )}
          {drawer && !mobile && (
            <ShellButton data-sidebar-toggle label="Close sidebar" onClick={toggleSidebar}>
              <PanelLeft />
            </ShellButton>
          )}
        </div>
        {workspaces.length ? (
          <>
            <Button
              variant="secondary"
              size="lg"
              className="touch-target"
              onClick={() =>
                void create().catch((error: unknown) =>
                  setSessionError(
                    error instanceof Error ? error.message : 'Could not start a session.',
                  ),
                )
              }
            >
              <MessageCirclePlus />
              New session
            </Button>
            {sessionError && (
              <p role="alert" className="px-2 text-sm text-destructive">
                {sessionError}
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <section aria-label="Workspaces" className="flex flex-col gap-1">
                <div className="flex min-h-9 items-center gap-1">
                  {searching ? (
                    <>
                      <Input
                        ref={searchInputRef}
                        className="touch-target"
                        autoFocus
                        aria-label="Search sessions"
                        placeholder="Search sessions"
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setSearchFolded(new Set());
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.stopPropagation();
                            closeSearch();
                          }
                        }}
                      />
                      <ShellButton label="Close search" onClick={closeSearch}>
                        <X />
                      </ShellButton>
                    </>
                  ) : (
                    <>
                      <span className="mr-auto text-xs font-medium text-muted-foreground">
                        Workspaces
                      </span>
                      <ShellButton
                        label="Search sessions"
                        ref={searchButtonRef}
                        onClick={() => setSearching(true)}
                      >
                        <Search />
                      </ShellButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<ShellButton label="View options" />}>
                          <SlidersHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            className="touch-target"
                            onClick={() => setSortByName((value) => !value)}
                          >
                            {sortByName ? 'Sort by creation' : 'Sort by name'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <DialogTrigger render={<ShellButton label="Add workspace" />}>
                        <FolderPlus />
                      </DialogTrigger>
                    </>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {workspaces.map((workspace) => {
                    const sessions = sessionsByWorkspace.get(workspace.id) ?? [];
                    if (searchTerm && !sessions.length) {
                      return null;
                    }

                    const expanded = !(searchTerm ? searchFolded : folded).has(workspace.id);
                    return (
                      <Collapsible
                        key={workspace.id}
                        open={expanded}
                        onOpenChange={() => toggleGroup(workspace.id)}
                        render={<section />}
                      >
                        <CollapsibleTrigger render={<DisclosureButton />}>
                          {expanded ? <FolderOpen /> : <Folder />}
                          <span className="min-w-0 flex-1 truncate text-left">
                            {workspaceLabel(workspace, workspaces)}
                          </span>
                          <ChevronDown className={expanded ? '' : '-rotate-90'} />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="flex flex-col gap-0.5 not-empty:pt-0.5">
                          {sessions.map((session) => (
                            <Link
                              key={session.id}
                              to={`/chat/${session.id}`}
                              aria-current={
                                !mobile && session.id === sessionId ? 'page' : undefined
                              }
                              onClick={closeDrawer}
                              className={sidebarLinkClassName(
                                'flex min-h-12 items-center rounded-lg py-1 pr-2 pl-8 text-sm aria-[current=page]:font-medium md:min-h-8',
                              )}
                            >
                              <span className="truncate">{sessionTitle(session)}</span>
                            </Link>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                  {query && !sessionsByWorkspace.size && (
                    <div className="px-2 py-4 text-sm text-muted-foreground">
                      <p className="break-words">No sessions match “{query}”.</p>
                      <Button
                        variant="link"
                        className="touch-target"
                        onClick={() => {
                          setQuery('');
                          searchInputRef.current?.focus();
                        }}
                      >
                        Clear search
                      </Button>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </>
        ) : (
          (mobile || drawer) && <WorkspaceStart />
        )}
        <WorkspaceDialogContent
          client={workspaceClient}
          mobile={mobile}
          open={adding}
          onAdded={async (id) => {
            await create(id);
            setAdding(false);
          }}
        />
      </div>
    </Dialog>
  );
}
