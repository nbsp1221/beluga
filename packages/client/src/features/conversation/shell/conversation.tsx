import { availableAccessModes } from '@workspace/protocol/host';
import { Dialog } from '@workspace/ui/components/dialog';
import { PaneTabsList } from '@workspace/ui/components/pane-tabs-list';
import { ShellButton } from '@workspace/ui/components/shell-button';
import { Tabs, TabsContent, TabsTrigger } from '@workspace/ui/components/tabs';
import { ToolbarSelect } from '@workspace/ui/components/toolbar-select';
import { ArrowLeft, PanelLeft, PanelRight, SlidersHorizontal } from 'lucide-react';
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { AgentPresetsClient } from '../../agent-presets/contract.js';
import type { ModelProvidersClient } from '../../model-providers/contract.js';
import type { WorkspaceClient } from '../../workspaces/contract.js';
import type {
  ConversationClient,
  ConversationView,
  ConversationViews,
  Session,
} from '../contract.js';
import { getEmptySnapshot, subscribeToEmptyStore } from '../../../state/store.js';
import { useLayout } from '../../../workbench/contract.js';
import { Composer } from '../composer/composer.js';
import { sessionTitle } from '../contract.js';
import { resolveConversationView } from '../view-registry.js';
import { ConversationStatistics } from './conversation-statistics.js';
import { WorkspaceDialogContent, WorkspaceStart } from './workspace-form.js';
import { WorkspacePicker } from './workspace-picker.js';

function useConversationCatalogs(
  agentPresets: AgentPresetsClient | undefined,
  modelProviders: ModelProvidersClient | undefined,
  draftId: string | undefined,
) {
  const catalog = useSyncExternalStore(
    agentPresets?.subscribe ?? subscribeToEmptyStore,
    agentPresets?.getSnapshot ?? getEmptySnapshot,
  );
  const models = useSyncExternalStore(
    modelProviders?.subscribe ?? subscribeToEmptyStore,
    modelProviders?.getSnapshot ?? getEmptySnapshot,
  );
  useEffect(() => {
    if (draftId) {
      void agentPresets?.refresh().catch(() => undefined);
    }
  }, [agentPresets, draftId]);
  return { catalog, models };
}

function useComposerSeat(floatingComposer: boolean, hasSession: boolean, hasWorkspaces: boolean) {
  const composerSeatRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  useLayoutEffect(() => {
    const seat = composerSeatRef.current;
    if (!floatingComposer || !seat) {
      return;
    }

    const measure = () => setComposerHeight(seat.offsetHeight);

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(seat);
    return () => observer.disconnect();
  }, [floatingComposer, hasSession, hasWorkspaces]);

  return { composerSeatRef, composerHeight };
}

function conversationViewSearch(current: URLSearchParams, view: string) {
  const next = new URLSearchParams(current);
  if (view === 'chat') {
    next.delete('view');
  } else {
    next.set('view', view);
  }
  return next;
}

export function Conversation({
  client,
  views,
  workspaceClient,
  agentPresets,
  modelProviders,
}: {
  client: ConversationClient;
  views: ConversationViews;
  workspaceClient: WorkspaceClient;
  agentPresets?: AgentPresetsClient;
  modelProviders?: ModelProvidersClient;
}) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const workspaces = useSyncExternalStore(workspaceClient.subscribe, workspaceClient.getSnapshot);
  const entries = useSyncExternalStore(views.subscribe, views.getSnapshot);
  const routeId = useParams()['*'];
  const { mobile } = useLayout();

  const initialId = client.initialSessionId ?? 'welcome';
  const [lastSessionId, setLastSessionId] = useState(routeId || initialId);
  // Keep the hidden detail mounted when mobile navigation returns to its list.
  const id = routeId || (mobile ? lastSessionId : initialId);
  if (routeId && routeId !== lastSessionId) {
    setLastSessionId(routeId);
  }

  const session = snapshot.sessions.find((item) => item.id === id);
  const observableId = session?.isDraft ? undefined : session?.id;
  useEffect(() => {
    if (observableId) {
      return client.observeSession?.(observableId);
    }
  }, [client, observableId]);

  const workspace = workspaces.find((item) => item.id === session?.workspaceId);
  const navigate = useNavigate();
  const { catalog, models } = useConversationCatalogs(
    agentPresets,
    modelProviders,
    session?.isDraft ? session.id : undefined,
  );
  useEffect(() => {
    if (
      !routeId &&
      !mobile &&
      client.initialSessionId &&
      observableId === client.initialSessionId
    ) {
      void navigate(`/chat/${observableId}`, { replace: true });
    }
  }, [client.initialSessionId, mobile, navigate, observableId, routeId]);

  const [search, setSearch] = useSearchParams();
  const [mode, setMode] = useState('Standard mode');
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [sessionError, setSessionError] = useState<{
    id: string;
    message: string;
  }>();

  const isEmptyConversation = !session?.messages.length;
  const active = resolveConversationView(entries, search.get('view'));
  const floatingComposer = active?.composer === 'floating';
  const conversationVisible = !mobile || Boolean(routeId);
  const hasWorkspaces = workspaces.length > 0;
  const usageId =
    hasWorkspaces && active?.composer && conversationVisible ? observableId : undefined;
  useEffect(() => {
    if (usageId) {
      return client.observeUsage?.(usageId);
    }
  }, [client, usageId]);

  const { composerSeatRef, composerHeight } = useComposerSeat(
    floatingComposer,
    session !== undefined,
    hasWorkspaces,
  );

  useEffect(() => {
    document.title = `${mobile && !routeId ? 'Chats' : session ? sessionTitle(session) : 'Session not found'} · Beluga`;
  }, [mobile, routeId, session]);

  if (!session) {
    return (
      <div className="p-6 text-sm">
        This session is no longer available.{' '}
        <Link className="underline" to="/chat">
          Return to Chats
        </Link>
      </div>
    );
  }

  const agentPresetId = session.agentPresetId;
  const chosenPreset = catalog?.presets.find((preset) => preset.id === agentPresetId);
  const selectedCapabilities = chosenPreset?.capabilities ?? [];
  const missingCapability = selectedCapabilities.some(
    (id) => !catalog?.capabilities.some((capability) => capability.id === id),
  );
  const needsFolder = Boolean(session.isDraft) && !workspace;
  const presetError =
    session.isDraft && missingCapability
      ? 'A capability in this preset is unavailable.'
      : undefined;

  const activeCapabilities = session.isDraft
    ? selectedCapabilities
    : (session.agentPresetCapabilities ?? []);
  const accessModes =
    workspace?.path && catalog
      ? availableAccessModes(catalog.capabilities, activeCapabilities)
      : [];

  const configure = (workspaceId: string | null, presetId?: string) =>
    client.setDraftConfiguration?.(session.id, workspaceId, presetId);

  const selectWorkspace = async (id: string) => {
    if (id === session.workspaceId) {
      return;
    }
    if (session.isDraft) {
      configure(id, agentPresetId);
      return;
    }

    setSessionError(undefined);
    try {
      await navigate(`/chat/${await client.createSession(id)}`);
    } catch (error) {
      setSessionError({
        id: session.id,
        message: error instanceof Error ? error.message : 'Could not start a session.',
      });
    }
  };

  const composerPlacement = floatingComposer ? 'absolute inset-x-0 bottom-0 z-10' : '';
  const composerPadding = mobile
    ? 'px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]'
    : isEmptyConversation && !floatingComposer
      ? 'px-4 my-auto py-6'
      : 'px-4 py-4';
  const composerVisibility = active?.composer ? '' : 'hidden';

  const floatingStyle: CSSProperties & Record<'--conversation-composer-clearance', string> = {
    '--conversation-composer-clearance': `${composerHeight}px`,
  };
  return (
    <Tabs
      value={active?.id ?? 'chat'}
      onValueChange={(value) => {
        entries.find(({ id }) => id === value)?.prepare?.(session);
        setSearch((current) => conversationViewSearch(current, String(value)));
      }}
      className="h-full min-h-0 min-w-0 gap-0"
    >
      <ConversationHeader
        session={session}
        entries={entries}
        activeViewId={active?.id}
        hasWorkspaces={hasWorkspaces}
        isEmptyConversation={isEmptyConversation}
        clientMode={client.mode}
        mode={mode}
        onBack={() => {
          void navigate('/chat');
        }}
      />
      <Dialog open={addingWorkspace} onOpenChange={setAddingWorkspace}>
        {hasWorkspaces ? (
          <div
            className={
              floatingComposer
                ? 'relative flex min-h-0 flex-1 flex-col'
                : isEmptyConversation && !mobile
                  ? 'flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain'
                  : 'flex min-h-0 flex-1 flex-col'
            }
            style={floatingComposer ? floatingStyle : undefined}
          >
            <ConversationPanes
              entries={entries}
              session={session}
              activeViewId={active?.id}
              conversationVisible={conversationVisible}
              isEmptyConversation={isEmptyConversation}
              mobile={mobile}
            />
            {floatingComposer && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 z-[9] h-[var(--conversation-composer-clearance,0px)] bg-linear-to-t from-background via-background/80 to-transparent"
              />
            )}
            <div
              key="composer-seat"
              ref={composerSeatRef}
              className={`mx-auto w-full max-w-3xl shrink-0 ${composerPlacement} ${composerPadding} ${composerVisibility}`}
            >
              {isEmptyConversation && (
                <>
                  {!mobile && (
                    <h2 className="mb-6 px-2 text-center text-2xl leading-8 font-medium text-balance">
                      Beluga
                    </h2>
                  )}
                  <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2 px-2">
                    <WorkspacePicker
                      workspaces={workspaces}
                      selected={workspace}
                      open={workspacePickerOpen}
                      onOpenChange={setWorkspacePickerOpen}
                      disabled={session.savingDraft}
                      onAdd={() => setAddingWorkspace(true)}
                      onSelect={(id) => void selectWorkspace(id)}
                    />
                    {session.isDraft && catalog && (
                      <ToolbarSelect
                        label="Agent preset"
                        disabled={session.savingDraft || !catalog.presets.length}
                        value={agentPresetId ?? ''}
                        options={catalog.presets.map((preset) => preset.id)}
                        getLabel={(id) =>
                          catalog.presets.find((preset) => preset.id === id)?.name ??
                          'Choose agent preset'
                        }
                        getDescription={(id) =>
                          catalog.presets.find((preset) => preset.id === id)?.description
                        }
                        onChange={(id) => configure(session.workspaceId, id)}
                      >
                        <SlidersHorizontal />
                      </ToolbarSelect>
                    )}
                    {client.mode === 'demo' && !mobile && (
                      <ToolbarSelect
                        label="Agent mode"
                        className="max-w-full text-muted-foreground"
                        value={mode}
                        options={['Standard mode', 'Plan mode']}
                        onChange={setMode}
                      >
                        <SlidersHorizontal />
                      </ToolbarSelect>
                    )}
                  </div>
                  {presetError && (
                    <p className="mb-2 px-2 text-sm text-muted-foreground">{presetError}</p>
                  )}
                  {sessionError?.id === session.id && (
                    <p role="alert" className="mb-2 px-2 text-sm text-destructive">
                      {sessionError.message}
                    </p>
                  )}
                </>
              )}
              <Composer
                key={session.id}
                client={client}
                session={session}
                mode={mode}
                blocked={
                  Boolean(presetError) ||
                  needsFolder ||
                  (Boolean(catalog && session.isDraft) && !chosenPreset)
                }
                workspacePicker={
                  needsFolder
                    ? {
                        open: workspacePickerOpen,
                        onOpen: () => setWorkspacePickerOpen(true),
                      }
                    : undefined
                }
                accessModes={accessModes}
                models={models?.models}
                defaultModel={models?.defaultModel}
                onModeChange={setMode}
              />
              <ConversationStatistics session={session} composerSeat={composerSeatRef} />
            </div>
          </div>
        ) : (
          <WorkspaceStart />
        )}
        <WorkspaceDialogContent
          client={workspaceClient}
          mobile={mobile}
          open={addingWorkspace}
          onAdded={async (id) => {
            if (session.isDraft) {
              configure(id, agentPresetId);
            } else {
              await navigate(`/chat/${await client.createSession(id)}`);
            }
            setAddingWorkspace(false);
          }}
        />
      </Dialog>
    </Tabs>
  );
}

function ConversationPanes({
  entries,
  session,
  activeViewId,
  conversationVisible,
  isEmptyConversation,
  mobile,
}: {
  entries: ReturnType<ConversationViews['getSnapshot']>;
  session: Session;
  activeViewId: string | undefined;
  conversationVisible: boolean;
  isEmptyConversation: boolean;
  mobile: boolean;
}) {
  const [openedViews, setOpenedViews] = useState<ReadonlySet<string>>(() => new Set());
  const visibleView =
    conversationVisible && (activeViewId !== 'chat' || !isEmptyConversation)
      ? activeViewId
      : undefined;
  if (visibleView && !openedViews.has(visibleView)) {
    setOpenedViews(new Set([...openedViews, visibleView]));
  }

  return (
    <div
      className={
        isEmptyConversation && activeViewId === 'chat' && !mobile ? 'shrink-0' : 'min-h-0 flex-1'
      }
    >
      {entries.map((entry) => (
        <TabsContent key={entry.id} value={entry.id} keepMounted className="h-full min-h-0">
          {openedViews.has(entry.id) && (!isEmptyConversation || entry.id !== 'chat') && (
            <entry.component
              session={session}
              active={entry.id === activeViewId && conversationVisible}
            />
          )}
          {mobile && isEmptyConversation && entry.id === 'chat' && (
            <div className="flex h-full items-center justify-center overflow-y-auto p-6">
              <h2 className="text-center text-xl font-medium text-balance">Beluga</h2>
            </div>
          )}
        </TabsContent>
      ))}
    </div>
  );
}

function ConversationHeader({
  session,
  entries,
  activeViewId,
  hasWorkspaces,
  isEmptyConversation,
  clientMode,
  mode,
  onBack,
}: {
  session: Session;
  entries: ReturnType<ConversationViews['getSnapshot']>;
  activeViewId?: string;
  hasWorkspaces: boolean;
  isEmptyConversation: boolean;
  clientMode: ConversationClient['mode'];
  mode: string;
  onBack: () => void;
}) {
  const { mobile, collapsed, drawer, toggleSidebar, panels, activePanel, togglePanel } =
    useLayout();
  return (
    <header className="shrink-0 border-b px-3 pt-2 md:px-5">
      <div className="flex min-h-8 items-start gap-2">
        <ShellButton
          data-sidebar-toggle
          size="icon"
          label={
            mobile ? 'Back to Chats' : drawer || collapsed ? 'Open sidebar' : 'Collapse sidebar'
          }
          onClick={mobile ? onBack : toggleSidebar}
        >
          {mobile ? <ArrowLeft /> : <PanelLeft />}
        </ShellButton>
        <div className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <h1
            className={
              mobile
                ? 'flex min-h-11 min-w-0 items-center truncate text-sm font-semibold'
                : 'min-w-0 py-1.5 text-sm font-semibold [overflow-wrap:anywhere] break-words'
            }
          >
            {isEmptyConversation ? 'Chats' : sessionTitle(session)}
          </h1>
          {clientMode === 'connected' && !session.isDraft && session.agentPresetName ? (
            <span className="min-w-0 py-1.5 text-sm text-muted-foreground">
              Agent · {session.agentPresetName}
              {session.agentPresetVersion && ` · v${session.agentPresetVersion}`}
            </span>
          ) : clientMode === 'demo' && !mobile && !isEmptyConversation ? (
            <span className="min-w-0 py-1.5 text-sm text-muted-foreground">{mode}</span>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {hasWorkspaces &&
            panels.map((panel) => (
              <ShellButton
                key={panel.id}
                size="icon"
                label={`${activePanel === panel.id ? 'Close' : 'Open'} ${panel.label}`}
                hint={panel.unavailable ? `${panel.label} is not available yet` : undefined}
                hintSide={panel.unavailable ? 'bottom' : undefined}
                disabled={panel.unavailable}
                focusableWhenDisabled={panel.unavailable}
                aria-expanded={activePanel === panel.id}
                onClick={() => togglePanel(panel.id)}
              >
                <PanelRight />
              </ShellButton>
            ))}
        </div>
      </div>
      {hasWorkspaces && entries.length > 1 && (
        <PaneTabsList railClassName="mt-1" aria-label="Conversation views" className="gap-4">
          {entries.map((entry) => (
            <ConversationViewTab
              key={entry.id}
              entry={entry}
              session={session}
              selected={entry.id === activeViewId}
            />
          ))}
        </PaneTabsList>
      )}
    </header>
  );
}

const viewIntentDelayMs = 50;

function ConversationViewTab({
  entry,
  session,
  selected,
}: {
  entry: ConversationView;
  session: Session;
  selected: boolean;
}) {
  const timerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timerRef.current), [session.id, selected]);

  function cancelPreparation() {
    window.clearTimeout(timerRef.current);
  }

  function prepareOnIntent() {
    const prepare = entry.prepare;
    if (!prepare || selected) {
      return;
    }

    cancelPreparation();
    timerRef.current = window.setTimeout(() => prepare(session), viewIntentDelayMs);
  }

  return (
    <TabsTrigger
      value={entry.id}
      className="touch-target max-md:flex-none"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') {
          prepareOnIntent();
        }
      }}
      onPointerLeave={cancelPreparation}
      onFocus={(event) => {
        if (event.currentTarget.matches(':focus-visible')) {
          prepareOnIntent();
        }
      }}
      onBlur={cancelPreparation}
    >
      {entry.label}
    </TabsTrigger>
  );
}
