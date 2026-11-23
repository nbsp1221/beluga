import type { ConversationActivity } from '@workspace/protocol/host';
import { BelugaMark } from '@workspace/ui/components/beluga-mark';
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
import { useLocation, useNavigate } from 'react-router';
import type { WorkspaceClient } from '../../workspaces/contract.js';
import { getEmptySnapshot, subscribeToEmptyStore } from '../../../state/store.js';
import { useLayout } from '../../../workbench/contract.js';
import { type ConversationClient, type Session, sessionTitle } from '../contract.js';
import { SessionActivity } from './session-activity.js';
import { SessionRow } from './session-row.js';
import { WorkspaceDialogContent, WorkspaceStart } from './workspace-form.js';
import { workspaceLabel } from './workspace-label.js';

const listRowSpacing = 'gap-2 px-2';

export function ConversationSidebar({
  client,
  workspaceClient,
}: {
  client: ConversationClient;
  workspaceClient: WorkspaceClient;
}) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const activity = useSyncExternalStore(
    client.activity?.subscribe ?? subscribeToEmptyStore,
    client.activity?.getSnapshot ?? getEmptySnapshot,
  );
  const workspaces = useSyncExternalStore(workspaceClient.subscribe, workspaceClient.getSnapshot);
  const { mobile, drawer, toggleSidebar, closeDrawer } = useLayout();
  const navigate = useNavigate();
  const routeSessionId = useLocation().pathname.split('/')[2];
  const sessionId = routeSessionId || client.initialSessionId || 'welcome';
  const currentSession = snapshot.sessions.find((session) => session.id === sessionId);

  const sessionActivity = (session: Session) => getSessionActivity(session, activity, sessionId);

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
    workspaceId = currentSession?.workspaceId ??
      (client.mode === 'demo' ? (workspaces[0]?.id ?? null) : null),
  ) => {
    setSessionError('');
    await navigate(`/chat/${await client.createSession(workspaceId)}`);
    closeDrawer();
  };

  const searchTerm = query.toLowerCase();
  const currentDraft =
    !searchTerm && (!mobile || routeSessionId) && currentSession?.isDraft
      ? currentSession
      : undefined;

  const setGroupExpanded = (id: string, expanded: boolean) =>
    (searchTerm ? setSearchFolded : setFolded)((current) => {
      if (current.has(id) === !expanded) {
        return current;
      }
      const next = new Set(current);
      if (expanded) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const startSession = async (workspaceId?: string) => {
    try {
      await create(workspaceId);
      if (workspaceId) {
        setGroupExpanded(workspaceId, true);
      }
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not start a session.');
    }
  };

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
        <div className="flex min-h-9 shrink-0 items-center justify-between gap-2 ps-2">
          {mobile ? (
            <h1 className="truncate text-base font-semibold">Chats</h1>
          ) : (
            <div className="flex min-w-0 items-center gap-2 text-base font-semibold">
              <span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
                <BelugaMark className="size-4 text-current" />
              </span>
              <span className="truncate">Beluga</span>
            </div>
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
              onClick={() => void startSession()}
            >
              <MessageCirclePlus />
              New session
            </Button>
            {sessionError && (
              <p role="alert" className="px-2 text-sm text-destructive">
                {sessionError}
              </p>
            )}
            <div className="flex min-h-0 flex-1 flex-col">
              <section aria-label="Workspaces" className="flex min-h-0 flex-1 flex-col gap-1">
                <div
                  className={`flex min-h-9 shrink-0 items-center gap-1${searching ? '' : ' ps-2'}`}
                >
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
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
                  {workspaces.map((workspace) => {
                    const savedSessions = sessionsByWorkspace.get(workspace.id) ?? [];
                    const sessions =
                      currentDraft?.workspaceId === workspace.id
                        ? [currentDraft, ...savedSessions]
                        : savedSessions;
                    if (searchTerm && !sessions.length) {
                      return null;
                    }

                    const expanded = !(searchTerm ? searchFolded : folded).has(workspace.id);
                    const label = workspaceLabel(workspace, workspaces);
                    return (
                      <Collapsible
                        key={workspace.id}
                        open={expanded}
                        onOpenChange={(open) => setGroupExpanded(workspace.id, open)}
                        render={<section />}
                      >
                        <div className="group/workspace flex items-center rounded-lg hover:bg-sidebar-accent has-focus-visible:bg-sidebar-accent">
                          <CollapsibleTrigger
                            render={
                              <DisclosureButton
                                className={`min-w-0 flex-1 hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent ${listRowSpacing}`}
                              />
                            }
                          >
                            <span aria-hidden="true" className="group-hover/workspace:hidden">
                              {expanded ? <FolderOpen /> : <Folder />}
                            </span>
                            <ChevronDown
                              aria-hidden="true"
                              className={
                                expanded
                                  ? 'hidden group-hover/workspace:block'
                                  : 'hidden -rotate-90 group-hover/workspace:block'
                              }
                            />
                            <span className="truncate text-left">{label}</span>
                          </CollapsibleTrigger>
                          {!searchTerm && (
                            <ShellButton
                              label={`New session in ${label}`}
                              data-collapsed={!expanded || undefined}
                              className="text-muted-foreground [@media(hover:hover)]:not-group-hover/workspace:not-group-focus-within/workspace:hidden [@media(hover:none)]:data-collapsed:hidden"
                              onClick={() => void startSession(workspace.id)}
                            >
                              <MessageCirclePlus />
                            </ShellButton>
                          )}
                        </div>
                        <CollapsibleContent className="flex flex-col gap-0.5 not-empty:pt-0.5">
                          {sessions.map((session) => (
                            <SessionRow
                              key={session.id}
                              session={session}
                              current={!mobile && session.id === sessionId}
                              {...sessionActivity(session)}
                              onClick={closeDrawer}
                            />
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
                        className="touch-target px-0"
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
              {client.activity && (
                <SessionActivity
                  sessions={snapshot.sessions}
                  workspaces={workspaces}
                  currentId={mobile ? undefined : sessionId}
                  activity={activity}
                  onOpen={closeDrawer}
                />
              )}
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

function getSessionActivity(
  session: Session,
  activity: ConversationActivity | undefined,
  currentId: string,
) {
  const status = activity?.[session.id];
  return {
    running: Boolean(status?.running || (session.id === currentId && session.activeSubmissionId)),
    unread: Boolean(status?.unreadCompletion),
  };
}
