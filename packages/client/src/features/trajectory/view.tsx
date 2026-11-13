import type { TrajectoryRecord, TrajectoryRequest } from '@workspace/protocol/host';
import { Button } from '@workspace/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@workspace/ui/components/resizable';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableRow,
} from '@workspace/ui/components/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip';
import { ChevronRight, Ellipsis, X } from 'lucide-react';
import {
  type ComponentProps,
  Fragment,
  type Ref,
  type RefObject,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { TrajectoryClient, TrajectorySnapshot } from './contract.js';
import { TrajectoryToolbar, trajectoryRowHeight } from './frame.js';
import { TrajectoryInspector } from './inspector.js';
import { TrajectoryLoading } from './loading.js';
import {
  isSummaryRequest,
  matchesRecord,
  payloadText,
  recordKey,
  recordTitle,
  resultText,
  statusLabels,
} from './records.js';
import { trajectoryRoles } from './roles.js';
import { type TimeRange, type TimelineSpan, timelineSpans } from './timeline-spans.js';
import { TrajectoryTimeline } from './timeline.js';

const empty: readonly TrajectoryRequest[] = [];
const pageSize = 50;
const durationStorageKey = 'beluga.trajectory.duration';
const defaultInspectorWidth = '38%';
const inspectorWidthStepPx = 24;
const noFolds: ReadonlySet<string> = new Set();
const rowControlHover = 'hover:bg-transparent dark:hover:bg-transparent';
// Paint the translucent border over the base surface, outside the row's hover color.
const turnDivider =
  '[&>td]:relative [&>td]:after:pointer-events-none [&>td]:after:absolute [&>td]:after:inset-x-0 [&>td]:after:top-0 [&>td]:after:h-0.5 [&>td]:after:border-t-2 [&>td]:after:border-border [&>td]:after:bg-background';

type Selection = {
  request: TrajectoryRequest;
  record?: TrajectoryRecord;
  modelRequest?: boolean;
};

function callGroup(
  request: TrajectoryRequest,
  record: Extract<TrajectoryRecord, { kind: 'tool' }>,
) {
  return `${request.id}/${record.modelRequestId ?? 'tools'}`;
}

function matchingSpanKeys(spans: readonly TimelineSpan[], term: string, offset: number) {
  if (!term) {
    return undefined;
  }
  return new Set(
    spans.flatMap(({ key, record, request, turnIndex, requestNumber }) => {
      if (
        !matchesRecord(record, term) &&
        !`turn ${offset + turnIndex + 1}`.includes(term) &&
        !(requestNumber && `request #${requestNumber}`.includes(term))
      ) {
        return [];
      }
      return record.kind === 'tool' && record.modelRequestId
        ? [key, `${request.id}/${record.modelRequestId}`]
        : [key];
    }),
  );
}

function toggle(set: ReadonlySet<string>, id: string) {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function TrajectoryView({
  sessionId,
  loadModelInput,
  snapshot,
}: {
  sessionId: string;
  snapshot?: TrajectorySnapshot;
  loadModelInput?: TrajectoryClient['loadModelInput'];
}) {
  const requests = snapshot?.requests ?? empty;

  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(pageSize);
  const [duration, setDuration] = useState(
    () => localStorage.getItem(durationStorageKey) === 'true',
  );
  const [foldedTurns, setFoldedTurns] = useState<ReadonlySet<string>>(() => new Set());
  const [foldedCalls, setFoldedCalls] = useState<ReadonlySet<string>>(() => new Set());
  const [range, setRange] = useState<TimeRange>();
  const [selected, setSelected] = useState<{
    requestId: string;
    recordId?: string;
    modelRequest?: boolean;
  }>();
  const [tab, setTab] = useState('Summary');
  const { surface, narrow } = useTrajectoryWidth();
  const viewportRef = useRef<HTMLDivElement>(null);
  const inspectorHeadingRef = useRef<HTMLSpanElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  const pendingRevealRef = useRef<string | null>(null);
  const followTailRef = useRef(true);
  const prependHeightRef = useRef<number | null>(null);
  const panelRef = useRef<InspectorPanelHandle>(null);

  const term = useDeferredValue(query.trim().toLowerCase());
  const offset = Math.max(0, requests.length - limit);
  const visible = useMemo(() => requests.slice(offset), [requests, offset]);
  const visibleCallGroups = visible.flatMap((request) =>
    request.records.flatMap((record) =>
      record.kind === 'tool' ? [callGroup(request, record)] : [],
    ),
  );
  const allTurnsFolded =
    visible.length > 0 && visible.every((request) => foldedTurns.has(request.id));
  const allCallsFolded =
    visibleCallGroups.length > 0 && visibleCallGroups.every((group) => foldedCalls.has(group));
  const earlierModelRequests = useMemo(
    () =>
      requests
        .slice(0, offset)
        .reduce(
          (count, turn) =>
            count +
            turn.records.filter(
              (record) => record.kind === 'assistant' && !isSummaryRequest(record),
            ).length,
          0,
        ),
    [requests, offset],
  );
  const spans = useMemo(
    () => timelineSpans(visible, duration, earlierModelRequests),
    [visible, duration, earlierModelRequests],
  );

  const matches = useMemo(() => matchingSpanKeys(spans, term, offset), [spans, term, offset]);
  const spanByKey = useMemo(() => new Map(spans.map((span) => [span.key, span])), [spans]);

  const selectedRequest = requests.find(({ id }) => id === selected?.requestId);
  const selectedRecord = selectedRequest?.records.find(({ id }) => id === selected?.recordId);
  const selectedKey =
    selectedRequest && selectedRecord ? recordKey(selectedRequest, selectedRecord) : undefined;
  const selectedModelNumber =
    selected?.modelRequest && selectedKey ? spanByKey.get(selectedKey)?.requestNumber : undefined;
  const inspectorOpen = Boolean(selectedRequest);

  useLayoutEffect(() => {
    if (inspectorOpen) {
      inspectorHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [inspectorOpen, narrow]);
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element?.clientHeight) {
      return;
    }

    // Reveal an explicit selection before applying automatic scroll rules.
    const reveal = pendingRevealRef.current;
    if (reveal) {
      const target = Array.from(element.querySelectorAll<HTMLElement>('[data-record-key]')).find(
        (node) => node.dataset.recordKey === reveal,
      );
      if (target) {
        target.scrollIntoView({ block: 'nearest' });
        pendingRevealRef.current = null;
        return;
      }
    }

    if (prependHeightRef.current !== null) {
      element.scrollTop += element.scrollHeight - prependHeightRef.current;
      prependHeightRef.current = null;
    } else if (followTailRef.current && !term) {
      element.scrollTop = element.scrollHeight;
    }
  }, [visible, term, selected, foldedCalls, foldedTurns, narrow]);

  function select(
    { request, record, modelRequest }: Selection,
    trigger?: HTMLElement,
    reveal = false,
  ) {
    if (trigger) {
      lastTriggerRef.current = trigger;
    }
    if (record && reveal && !isSummaryRequest(record)) {
      followTailRef.current = false;
      pendingRevealRef.current = recordKey(request, record);
      setFoldedTurns((current) => new Set([...current].filter((id) => id !== request.id)));
      if (record.kind === 'tool') {
        setFoldedCalls(
          (current) => new Set([...current].filter((id) => id !== callGroup(request, record))),
        );
      }
      if (matches && !matches.has(pendingRevealRef.current)) {
        setQuery('');
      }
    }
    setSelected({ requestId: request.id, recordId: record?.id, modelRequest });
  }

  function close(restore: boolean) {
    setSelected(undefined);
    if (restore) {
      requestAnimationFrame(() => {
        const trigger = lastTriggerRef.current;
        if (trigger?.isConnected && trigger.getClientRects().length) {
          trigger.focus();
        } else {
          searchRef.current?.focus();
        }
      });
    }
  }

  function timelineSelect(key: string) {
    const span = spanByKey.get(key);
    if (span) {
      select(span, searchRef.current ?? undefined, true);
    }
  }

  function selectInInspector(selection: Selection) {
    select(selection, undefined, true);
    inspectorHeadingRef.current?.focus({ preventScroll: true });
  }

  const inspector = selectedRequest && (
    <TrajectoryDetails
      sessionId={sessionId}
      request={selectedRequest}
      record={selectedRecord}
      turnNumber={requests.indexOf(selectedRequest) + 1}
      requestNumber={selectedModelNumber}
      modelRequest={selected?.modelRequest === true}
      step={selectedKey ? spanByKey.get(selectedKey)?.step : undefined}
      narrow={narrow}
      heading={inspectorHeadingRef}
      panel={panelRef}
      loadModelInput={loadModelInput}
      tab={tab}
      onTab={setTab}
      onClose={() => close(true)}
      onSelect={selectInInspector}
    />
  );

  const phase = snapshot?.phase;
  return (
    <section ref={surface} aria-label="Trajectory" className="flex h-full min-h-0 min-w-0 flex-col">
      <TrajectoryToolbar
        controls={{
          duration,
          turnsFolded: allTurnsFolded,
          callsFolded: allCallsFolded,
          hasTurns: visible.length > 0,
          hasCalls: visibleCallGroups.length > 0,
          search: searchRef,
          query,
          toggleDuration: () => {
            setDuration(!duration);
            setRange(undefined);
            localStorage.setItem(durationStorageKey, String(!duration));
          },
          toggleTurns: () =>
            setFoldedTurns(new Set(allTurnsFolded ? [] : visible.map(({ id }) => id))),
          toggleCalls: () => setFoldedCalls(new Set(allCallsFolded ? [] : visibleCallGroups)),
          onSearch: (value) => {
            followTailRef.current = false;
            if (viewportRef.current && value.trim()) {
              viewportRef.current.scrollTop = 0;
            }
            setQuery(value);
          },
        }}
      />
      <TrajectoryTimeline
        key={String(duration)}
        spans={spans}
        selected={selectedKey}
        matches={matches}
        range={range}
        onRange={setRange}
        onSelect={timelineSelect}
      />
      {matches?.size === 0 && (
        <span className="sr-only" role="status">
          No matching records.
        </span>
      )}
      {phase === 'reconnecting' && (
        <span className="px-2 py-1 text-xs text-muted-foreground" role="status">
          Reconnecting…
        </span>
      )}
      <div className="relative min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel id="trajectory-ledger" minSize={narrow ? 0 : '280px'}>
            <div
              ref={viewportRef}
              inert={narrow && inspectorOpen}
              aria-label="Trajectory records"
              className="[container-type:inline-size] h-full overflow-auto overscroll-contain pb-[var(--conversation-composer-clearance,0px)]"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  close(false);
                  setRange(undefined);
                }
              }}
              onScroll={(event) => {
                const list = event.currentTarget;
                followTailRef.current =
                  !term && list.scrollHeight - list.clientHeight - list.scrollTop <= 8;
              }}
            >
              <TrajectoryLedger
                phase={phase}
                loading={phase === 'loading' && requests.length === 0}
                offset={offset}
                term={term}
                visible={visible}
                foldedTurns={foldedTurns}
                foldedCalls={foldedCalls}
                matches={matches}
                selectedKey={selectedKey}
                modelRequestSelected={selected?.modelRequest}
                selectedTurnId={selectedRecord ? undefined : selectedRequest?.id}
                range={range}
                spans={spanByKey}
                select={select}
                toggleCalls={(id) => setFoldedCalls((current) => toggle(current, id))}
                toggleTurn={(id) => setFoldedTurns((current) => toggle(current, id))}
                onLoadEarlier={() => {
                  prependHeightRef.current = viewportRef.current?.scrollHeight ?? null;
                  followTailRef.current = false;
                  setLimit((count) => count + pageSize);
                }}
              />
            </div>
          </ResizablePanel>
          {!narrow && inspector && (
            <>
              <ResizableHandle aria-label="Resize event details" />
              <ResizablePanel
                id="trajectory-details"
                panelRef={panelRef}
                defaultSize={defaultInspectorWidth}
                minSize="320px"
                maxSize="440px"
              >
                {inspector}
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
        {narrow && inspector}
      </div>
    </section>
  );
}

function useTrajectoryWidth() {
  const surfaceRef = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(true);
  useEffect(() => {
    const target = surfaceRef.current;
    if (!target) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(0);
      if (entry && entry.contentRect.width > 0) {
        setNarrow(entry.contentRect.width < 760);
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return { surface: surfaceRef, narrow };
}

type InspectorPanelHandle =
  NonNullable<ComponentProps<typeof ResizablePanel>['panelRef']> extends Ref<infer Handle>
    ? Handle
    : never;

function TrajectoryDetails({
  sessionId,
  request,
  record,
  turnNumber,
  requestNumber,
  modelRequest,
  step,
  narrow,
  heading,
  panel,
  loadModelInput,
  tab,
  onTab,
  onClose,
  onSelect,
}: {
  sessionId: string;
  request: TrajectoryRequest;
  record?: TrajectoryRecord;
  turnNumber: number;
  requestNumber?: number;
  modelRequest: boolean;
  step?: number;
  narrow: boolean;
  heading: Ref<HTMLSpanElement>;
  panel: RefObject<InspectorPanelHandle | null>;
  loadModelInput?: TrajectoryClient['loadModelInput'];
  tab: string;
  onTab: (tab: string) => void;
  onClose: () => void;
  onSelect: (selection: Selection) => void;
}) {
  function adjustWidth(pixels: number) {
    const inspector = panel.current;
    if (inspector) {
      inspector.resize(`${inspector.getSize().inPixels + pixels}px`);
    }
  }

  return (
    <aside
      aria-label="Event details"
      className={`flex h-full min-h-0 min-w-0 flex-col bg-background ${narrow ? 'absolute inset-y-0 right-0 z-[5] w-11/12 max-w-105 border-l shadow-lg' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b px-3">
        <span ref={heading} tabIndex={-1} className="min-w-0 flex-1 truncate text-xs font-medium">
          {requestNumber !== undefined && <>Request #{requestNumber} · </>}
          {modelRequest && requestNumber === undefined && <>Summary request · </>}
          {record && !modelRequest && (
            <>
              <span
                className={`mr-2 rounded-sm px-1 py-0.5 uppercase ${trajectoryRoles[record.kind].tag}`}
              >
                {trajectoryRoles[record.kind].label}
              </span>
              {record.kind === 'tool' && <>{record.name} · </>}
            </>
          )}
          Turn {turnNumber}
          {requestNumber === undefined && Boolean(step) && <> · Step {step}</>}
        </span>
        {!narrow && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="icon-xs" variant="ghost" aria-label="Inspector width" />}
            >
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => adjustWidth(-inspectorWidthStepPx)}>
                Narrower
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => adjustWidth(inspectorWidthStepPx)}>
                Wider
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => panel.current?.resize(defaultInspectorWidth)}>
                Reset width
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="touch-target shrink-0"
          aria-label="Close details"
          onClick={() => onClose()}
        >
          <X />
        </Button>
      </div>
      <TrajectoryInspector
        sessionId={sessionId}
        loadModelInput={loadModelInput}
        record={record}
        request={request}
        modelRequest={modelRequest}
        activeTab={tab}
        onTab={onTab}
        onTurn={() => onSelect({ request })}
        onRecord={(record) => onSelect({ request, record })}
        onModelRequest={(record) => onSelect({ request, record, modelRequest: true })}
      />
    </aside>
  );
}

function TrajectoryLedger({
  phase,
  loading,
  offset,
  term,
  visible,
  foldedTurns,
  foldedCalls,
  matches,
  selectedKey,
  modelRequestSelected,
  selectedTurnId,
  range,
  spans,
  select,
  toggleCalls,
  toggleTurn,
  onLoadEarlier,
}: {
  phase?: TrajectorySnapshot['phase'];
  loading: boolean;
  offset: number;
  term: string;
  visible: readonly TrajectoryRequest[];
  foldedTurns: ReadonlySet<string>;
  foldedCalls: ReadonlySet<string>;
  matches?: ReadonlySet<string>;
  selectedKey?: string;
  modelRequestSelected?: boolean;
  selectedTurnId?: string;
  range?: TimeRange;
  spans: ReadonlyMap<string, TimelineSpan>;
  select: (selection: Selection, trigger?: HTMLElement, reveal?: boolean) => void;
  toggleCalls: (id: string) => void;
  toggleTurn: (id: string) => void;
  onLoadEarlier: () => void;
}) {
  return (
    <>
      {loading && <TrajectoryLoading />}
      {phase === 'unavailable' && (
        <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
          History unavailable
        </p>
      )}
      <Table className="table-fixed text-xs [&_tr:has(+tr[data-turn-start])]:border-b-0">
        <TableCaption className="sr-only">Trajectory records</TableCaption>
        <colgroup>
          <col className="w-14 @max-[620px]:w-12" />
          <col className="w-22 @max-[620px]:w-6" />
          <col />
        </colgroup>
        <TableBody>
          {offset > 0 && !term && (
            <TableRow>
              <TableCell colSpan={3} className="px-2 py-1">
                <Button variant="ghost" size="xs" className="touch-target" onClick={onLoadEarlier}>
                  Load earlier records
                </Button>
              </TableCell>
            </TableRow>
          )}
          {visible.map((request, index) => {
            const folded = foldedTurns.has(request.id) && !term;
            const source = request.records.filter(
              (record) =>
                !isSummaryRequest(record) && (!matches || matches.has(recordKey(request, record))),
            );
            if (matches && !source.length) {
              return null;
            }
            const initialPrompt = source[0]?.kind === 'system' && source[0].initial;
            const records = folded ? source.slice(0, initialPrompt ? 2 : 1) : source;
            const hidden = source.length - records.length;
            return (
              <TrajectoryRows
                key={request.id}
                request={request}
                number={offset + index + 1}
                records={records}
                hidden={hidden}
                foldedCalls={term || folded ? noFolds : foldedCalls}
                selectedKey={selectedKey}
                modelRequestSelected={modelRequestSelected}
                turnSelected={selectedTurnId === request.id}
                range={range}
                spans={spans}
                select={select}
                toggleCalls={toggleCalls}
                toggleTurn={() => toggleTurn(request.id)}
              />
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}

function TrajectoryRows({
  request,
  number,
  records,
  hidden,
  foldedCalls,
  selectedKey,
  modelRequestSelected,
  turnSelected,
  range,
  spans,
  select,
  toggleCalls,
  toggleTurn,
}: {
  request: TrajectoryRequest;
  number: number;
  records: readonly TrajectoryRecord[];
  hidden: number;
  foldedCalls: ReadonlySet<string>;
  selectedKey?: string;
  modelRequestSelected?: boolean;
  turnSelected: boolean;
  range?: TimeRange;
  spans: ReadonlyMap<string, TimelineSpan>;
  select: (selection: Selection, trigger?: HTMLElement, reveal?: boolean) => void;
  toggleCalls: (id: string) => void;
  toggleTurn: () => void;
}) {
  const callCounts = new Map<string, number>();
  for (const record of records) {
    if (record.kind !== 'tool') {
      continue;
    }
    const group = callGroup(request, record);
    if (foldedCalls.has(group)) {
      callCounts.set(group, (callCounts.get(group) ?? 0) + 1);
    }
  }

  const firstRecord = records.at(0);
  const firstTurnRow = firstRecord?.kind === 'system' && firstRecord.initial ? 1 : 0;
  const ungroupedCallsKey = `${request.id}/tools`;
  const ungroupedCalls = callCounts.get(ungroupedCallsKey);

  return (
    <>
      {records.map((record, index) => {
        if (record.kind === 'tool' && foldedCalls.has(callGroup(request, record))) {
          return null;
        }
        const key = recordKey(request, record);
        const turnStart = index === firstTurnRow;
        const span = spans.get(key);
        const outside = span && range && (span.end < range[0] || span.start > range[1]);

        const role = trajectoryRoles[record.kind];
        const tool = record.kind === 'tool' ? record : undefined;
        const failed =
          (record.kind === 'assistant' || record.kind === 'tool' || record.kind === 'compaction') &&
          record.status === 'failed';
        const output = tool?.error ?? resultText(tool?.output);
        const selected = selectedKey === key && !modelRequestSelected;
        const requestSelected = selectedKey === key && Boolean(modelRequestSelected);
        const requestNumber = span?.requestNumber;
        const description =
          record.kind === 'tool' ? (output ?? payloadText(record.input)) : record.text;
        const labelTitle = tool ? `${role.label} ${tool.name}` : role.label;
        const labelDetail = description?.slice(0, 160) || recordTitle(record);
        const recordLabel = `${labelTitle}${failed ? ', failed' : ''}: ${labelDetail}`;
        const collapsedCalls = callCounts.get(key);
        return (
          <Fragment key={key}>
            <TableRow
              tabIndex={0}
              aria-label={recordLabel}
              data-record-key={key}
              data-state={selected ? 'selected' : undefined}
              data-turn-start={turnStart || undefined}
              data-timeline-focus={outside ? 'outside' : undefined}
              className={`${trajectoryRowHeight} focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${turnStart ? turnDivider : ''} ${outside && !selected && !requestSelected ? 'opacity-40 focus-within:opacity-100' : ''}`}
              onClick={(event) => {
                if (window.getSelection()?.isCollapsed === false) {
                  return;
                }
                select({ request, record }, event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (
                  event.target !== event.currentTarget ||
                  (event.key !== 'Enter' && event.key !== ' ')
                ) {
                  return;
                }
                event.preventDefault();
                select({ request, record }, event.currentTarget);
              }}
              onDoubleClick={(event) => {
                if (record.kind !== 'assistant' || window.getSelection()?.isCollapsed === false) {
                  return;
                }
                const target = event.target;
                if (target instanceof Element && target.closest('button')) {
                  return;
                }
                toggleCalls(key);
              }}
            >
              <TableCell
                className={`relative px-0 py-1 text-center ${selected || failed ? 'before:pointer-events-none before:absolute before:inset-y-0 before:start-0 before:w-0.5' : ''} ${selected ? 'before:bg-ring' : failed ? 'before:bg-destructive' : ''}`}
              >
                {turnStart && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className={`touch-target max-w-full px-1 text-muted-foreground tabular-nums aria-pressed:bg-accent ${rowControlHover}`}
                    aria-label={`Turn ${number}`}
                    aria-pressed={turnSelected}
                    onClick={(event) => {
                      event.stopPropagation();
                      select({ request }, event.currentTarget);
                    }}
                    onDoubleClick={toggleTurn}
                  >
                    <span className="@max-[620px]:hidden">Turn {number}</span>
                    <span className="hidden @max-[620px]:inline">#{number}</span>
                  </Button>
                )}
                {requestNumber !== undefined && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="touch-target"
                          aria-label={`Request #${requestNumber}`}
                          aria-pressed={requestSelected}
                          onClick={(event) => {
                            event.stopPropagation();
                            select({ request, record, modelRequest: true }, event.currentTarget);
                          }}
                        >
                          <span
                            aria-hidden="true"
                            className={`size-1.5 rounded-full ${requestSelected ? 'bg-ring' : 'bg-muted-foreground'}`}
                          />
                        </Button>
                      }
                    />
                    <TooltipContent side="right">Request #{requestNumber}</TooltipContent>
                  </Tooltip>
                )}
              </TableCell>
              <TableCell className="px-1 py-1">
                <div className="flex min-w-0 items-center justify-end @max-[620px]:justify-center">
                  <span
                    className={`truncate rounded-sm px-1 py-0.5 font-medium uppercase @max-[620px]:hidden ${role.tag}`}
                  >
                    {role.label}
                  </span>
                  <role.icon
                    aria-hidden="true"
                    className={`hidden size-4 shrink-0 rounded-sm @max-[620px]:block ${role.tag}`}
                  />
                </div>
              </TableCell>
              <TableCell className="min-w-0 px-2 py-1">
                <div className="flex min-w-0 items-center gap-2 px-1">
                  {tool ? (
                    <>
                      <span className="shrink-0 font-mono font-medium">{tool.name}</span>
                      <span className="max-w-2/5 min-w-0 shrink-0 truncate font-mono text-muted-foreground">
                        {payloadText(tool.input)}
                      </span>
                      {output && (
                        <>
                          <span aria-hidden="true" className="shrink-0 text-muted-foreground">
                            →
                          </span>
                          <span
                            className={`min-w-0 truncate font-mono ${failed ? 'text-destructive' : 'text-muted-foreground'}`}
                          >
                            {output}
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    <span className="min-w-0 truncate">
                      {record.kind !== 'tool' &&
                        (record.text ||
                          (record.kind === 'assistant' && record.status !== 'completed'
                            ? statusLabels[record.status]
                            : 'Tool call only'))}
                    </span>
                  )}
                </div>
              </TableCell>
            </TableRow>
            {Boolean(collapsedCalls) && (
              <CollapsedRows
                label={`${collapsedCalls} ${collapsedCalls === 1 ? 'tool call' : 'tool calls'}`}
                onExpand={() => toggleCalls(key)}
              />
            )}
          </Fragment>
        );
      })}
      {hidden > 0 && <CollapsedRows label={`${hidden} more records`} onExpand={toggleTurn} />}
      {Boolean(ungroupedCalls) && (
        <CollapsedRows
          label={`${ungroupedCalls} tool calls`}
          onExpand={() => toggleCalls(ungroupedCallsKey)}
        />
      )}
      {request.records.length === 0 && (
        <TableRow>
          <TableCell className="px-2 py-1">Turn {number}</TableCell>
          <TableCell colSpan={2}>{statusLabels[request.status]}</TableCell>
        </TableRow>
      )}
    </>
  );
}

function CollapsedRows({ label, onExpand }: { label: string; onExpand: () => void }) {
  return (
    <TableRow>
      <TableCell />
      <TableCell />
      <TableCell className="px-2 py-1">
        <Button
          size="xs"
          variant="ghost"
          className="touch-target text-muted-foreground"
          aria-expanded={false}
          onClick={onExpand}
        >
          <ChevronRight />
          {label}
        </Button>
      </TableCell>
    </TableRow>
  );
}
