import { Button } from '@workspace/ui/components/button';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@workspace/ui/components/popover';
import { Progress } from '@workspace/ui/components/progress';
import { Separator } from '@workspace/ui/components/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip';
import { Database, Gauge } from 'lucide-react';
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import type { Session } from '../contract.js';

const compact = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const exact = new Intl.NumberFormat();
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function formatTime(ms: number) {
  const seconds = ms / 1000;
  if (seconds < 1) {
    return `${exact.format(Math.round(ms))} ms`;
  }
  if (seconds < 60) {
    return `${decimal.format(seconds)}s`;
  }
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

type Statistic = 'activity' | 'tokens' | 'context';
type Metric = readonly [label: string, value: string];

function MetricRows({ rows }: { rows: readonly Metric[] }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-xs tabular-nums">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatisticButton({
  id,
  title,
  reading,
  secondaryReading,
  hint,
  icon,
  open,
  onOpenChange,
  composerSeat,
  children,
}: {
  id: Statistic;
  title: string;
  reading: string;
  secondaryReading?: string;
  hint: string;
  icon: ReactNode;
  open: boolean;
  onOpenChange: (id: Statistic, open: boolean) => void;
  composerSeat?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const suppressReturnFocusHintRef = useRef(false);
  useLayoutEffect(
    () => () => {
      const focused = document.activeElement;
      if (triggerRef.current === focused || popupRef.current?.contains(focused)) {
        composerSeat?.current?.querySelector('textarea')?.focus();
      }
    },
    [composerSeat],
  );

  return (
    <Tooltip
      disabled={open}
      onOpenChange={(next, details) => {
        if (next && details.reason === 'trigger-focus' && suppressReturnFocusHintRef.current) {
          details.cancel();
        }
      }}
    >
      <Popover
        open={open}
        onOpenChange={(next, details) => {
          // Restored focus should not reopen the hint over another statistics button.
          if (!next && details.reason === 'escape-key') {
            suppressReturnFocusHintRef.current = true;
          }
          onOpenChange(id, next);
        }}
      >
        <PopoverTrigger
          ref={triggerRef}
          onBlur={() => {
            suppressReturnFocusHintRef.current = false;
          }}
          render={
            <TooltipTrigger
              render={<Button variant="ghost" size="xs" className="touch-target" />}
            />
          }
          aria-label={[reading, secondaryReading, title].filter(Boolean).join(' · ')}
        >
          {icon}
          <span>
            {reading}
            {secondaryReading && <span className="hidden md:inline"> · {secondaryReading}</span>}
          </span>
        </PopoverTrigger>
        <PopoverContent ref={popupRef} side="top" aria-label={id === 'context' ? title : undefined}>
          {id !== 'context' && (
            <>
              <PopoverTitle className="flex items-center gap-1.5 text-xs">
                {icon}
                {title}
              </PopoverTitle>
              <Separator />
            </>
          )}
          {children}
        </PopoverContent>
      </Popover>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function ContextRing({ percent }: { percent: number }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden="true">
      <circle cx="8" cy="8" r="6" strokeWidth="2" className="stroke-muted-foreground/25" />
      {percent > 0 && (
        <circle
          cx="8"
          cy="8"
          r="6"
          pathLength="100"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${percent} 100`}
          transform="rotate(-90 8 8)"
          className="stroke-current"
        />
      )}
    </svg>
  );
}

const contextCategories = [
  { id: 'systemPrompt', label: 'System prompt', color: 'bg-foreground/40' },
  { id: 'tools', label: 'Tool definitions', color: 'bg-primary/55' },
  { id: 'messages', label: 'Messages', color: 'bg-primary' },
] as const;

function ContextComposition({
  counts,
}: {
  counts: Record<(typeof contextCategories)[number]['id'], number>;
}) {
  const segments = contextCategories.filter(({ id }) => counts[id] > 0);
  if (!segments.length) {
    return null;
  }
  return (
    <div className="space-y-2 text-xs">
      <h3 className="font-medium">Estimated composition</h3>
      <div className="flex h-1 gap-px overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {segments.map(({ id, color }) => (
          <span key={id} className={color} style={{ flexGrow: counts[id] }} />
        ))}
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 tabular-nums">
        {segments.map(({ id, label, color }) => (
          <div key={id} className="contents">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-xs ${color}`} />
              {label}
            </dt>
            <dd className="text-right">~{compact.format(counts[id])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ConversationStatistics({
  session,
  composerSeat,
}: {
  session: Pick<Session, 'usage' | 'runSettings'>;
  composerSeat: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState<Statistic>();
  const usage = session.usage;
  const context = usage?.context;
  const contextAvailable =
    context?.status === 'available' && context.model === session.runSettings?.model;
  const visibleOpen =
    (open === 'context' && !contextAvailable) || (open === 'tokens' && !usage?.tokens)
      ? undefined
      : open;
  if (open !== visibleOpen) {
    setOpen(visibleOpen);
  }
  if (!usage?.turns) {
    return null;
  }

  const { turns, steps, modelMs, toolMs, averageFirstOutputMs, outputTokensPerSecond } = usage;
  const { tokens, input, output, cacheRead, cacheWrite } = usage;
  const promptTokens = input + cacheRead + cacheWrite;
  const cacheHit = promptTokens > 0 ? Math.round((cacheRead / promptTokens) * 100) : null;
  const activity = `${turns} ${turns === 1 ? 'turn' : 'turns'} · ${steps} ${steps === 1 ? 'step' : 'steps'}`;
  const speed =
    outputTokensPerSecond === null
      ? null
      : `${exact.format(Math.round(outputTokensPerSecond))} tok/s`;
  const timings: Metric[] = [];
  if (modelMs !== null) {
    timings.push(['Model time', formatTime(modelMs)]);
  }
  if (toolMs !== null) {
    timings.push(['Tool time', formatTime(toolMs)]);
  }
  if (averageFirstOutputMs !== null) {
    timings.push(['Avg. time to first output', formatTime(averageFirstOutputMs)]);
  }
  if (speed !== null) {
    timings.push(['Output speed', speed]);
  }
  const tokenRows: Metric[] = [
    ['Total', exact.format(tokens)],
    ['Uncached input', exact.format(input)],
    ['Output', exact.format(output)],
    ['Cache read', exact.format(cacheRead)],
  ];
  if (cacheWrite > 0) {
    tokenRows.push(['Cache write', exact.format(cacheWrite)]);
  }
  if (cacheHit !== null) {
    tokenRows.push(['Cache hit', `${cacheHit}%`]);
  }

  function changeOpen(id: Statistic, next: boolean) {
    setOpen((current) => (next ? id : current === id ? undefined : current));
  }

  const percent = contextAvailable
    ? Math.min(100, (context.inputTokens / context.contextWindow) * 100)
    : 0;
  const contextPercent = percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`;

  return (
    <TooltipProvider delay={200}>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 text-xs text-muted-foreground tabular-nums">
        <StatisticButton
          id="activity"
          title="Session statistics"
          reading={activity}
          secondaryReading={speed ?? undefined}
          hint={
            timings
              .slice(0, 2)
              .map(([label, value]) => `${label} ${value}`)
              .join(' · ') || 'Turns and model requests'
          }
          icon={<Gauge className="size-3.5" aria-hidden="true" />}
          open={visibleOpen === 'activity'}
          onOpenChange={changeOpen}
        >
          <MetricRows
            rows={[
              ['Turns', exact.format(turns)],
              ['Model requests', exact.format(steps)],
              ...timings,
            ]}
          />
        </StatisticButton>
        {tokens > 0 && (
          <StatisticButton
            id="tokens"
            title="Token usage"
            reading={`${compact.format(tokens)} tok`}
            secondaryReading={cacheHit === null ? undefined : `Cache hit ${cacheHit}%`}
            hint={`${compact.format(promptTokens)} input · ${compact.format(output)} output`}
            icon={<Database className="size-3.5" aria-hidden="true" />}
            open={visibleOpen === 'tokens'}
            onOpenChange={changeOpen}
          >
            <MetricRows rows={tokenRows} />
          </StatisticButton>
        )}
        {context?.status === 'compacting' && <span role="status">Compacting context…</span>}
        {contextAvailable && (
          <StatisticButton
            id="context"
            title="Context used"
            reading={contextPercent}
            hint={`${compact.format(context.inputTokens)} / ${compact.format(context.contextWindow)} tokens`}
            icon={<ContextRing percent={percent} />}
            open={visibleOpen === 'context'}
            onOpenChange={changeOpen}
            composerSeat={composerSeat}
          >
            <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
              <span>{contextPercent} used</span>
              <span className="text-muted-foreground">
                {exact.format(context.inputTokens)} / {exact.format(context.contextWindow)} tokens
              </span>
            </div>
            <Progress value={percent} aria-label="Context used" />
            {context.estimatedTokens && <ContextComposition counts={context.estimatedTokens} />}
          </StatisticButton>
        )}
      </div>
    </TooltipProvider>
  );
}
