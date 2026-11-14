import { Button } from '@workspace/ui/components/button';
import { Field, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@workspace/ui/components/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip';
import { type PointerEvent, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { TimeRange, TimelineSpan } from './timeline-spans.js';
import {
  TimelineControlButton,
  TrajectoryTimelineFrame,
  trajectoryLanes,
  trajectoryPlotSize,
} from './frame.js';
import { durationText, recordTitle } from './records.js';
import { trajectoryRoles } from './roles.js';

const full: TimeRange = [0, 1];
const minimumDomainWidth = 1 / 64;
const dragThresholdPx = 4;
const guideLineClass = 'pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-ring';

function bounds(a: number, b: number): TimeRange {
  return a <= b ? [a, b] : [b, a];
}

export function TrajectoryTimeline({
  spans,
  selected,
  matches,
  range,
  onRange,
  onSelect,
}: {
  spans: readonly TimelineSpan[];
  selected?: string;
  matches?: ReadonlySet<string>;
  range?: TimeRange;
  onRange: (range?: TimeRange) => void;
  onSelect: (key: string) => void;
}) {
  const [domain, setDomain] = useState<TimeRange>(full);
  const [draft, setDraft] = useState<TimeRange>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const hoverLineRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    x: number;
    point: number;
    button: number;
    domain: TimeRange;
  }>(null);
  const width = domain[1] - domain[0];

  const toPercent = (value: number) => ((value - domain[0]) / width) * 100;

  const locate = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return domain[0] + Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * width;
  };

  function updateHover(event: PointerEvent<HTMLDivElement>) {
    const line = hoverLineRef.current;
    if (!line) {
      return;
    }

    const overSpan = event.target instanceof Element && event.target.closest('[data-span-key]');
    line.hidden =
      event.pointerType !== 'mouse' || !spans.length || Boolean(dragRef.current || overSpan);
    if (!line.hidden) {
      const plot = event.currentTarget.getBoundingClientRect();
      line.style.left = `${event.clientX - plot.left}px`;
    }
  }

  const move = (start: number, size: number) => {
    const left = Math.min(Math.max(0, start), 1 - size);
    setDomain([left, left + size]);
  };

  const zoom = (factor: number, center = (domain[0] + domain[1]) / 2) => {
    const next = Math.min(1, Math.max(minimumDomainWidth, width * factor));
    move(center - ((center - domain[0]) / width) * next, next);
  };

  const wheelZoom = useEffectEvent((event: WheelEvent, plot: HTMLDivElement) => {
    if (!spans.length || !event.deltaY || event.ctrlKey || event.metaKey || !event.cancelable) {
      return;
    }
    if ((event.deltaY > 0 && width >= 1) || (event.deltaY < 0 && width <= minimumDomainWidth)) {
      return;
    }
    const box = plot.getBoundingClientRect();
    if (!box.width) {
      return;
    }
    event.preventDefault();
    const center = domain[0] + ((event.clientX - box.left) / box.width) * width;
    zoom(event.deltaY > 0 ? 1.3 : 0.77, center);
  });

  useEffect(() => {
    const plot = plotRef.current;
    if (plot) {
      const onWheel = (event: WheelEvent) => wheelZoom(event, plot);

      plot.addEventListener('wheel', onWheel, { passive: false });

      return () => plot.removeEventListener('wheel', onWheel);
    }
  }, []);

  const setRange = (value?: TimeRange) => {
    onRange(value);
    setFrom(value ? String(Math.round(value[0] * 1000) / 10) : '');
    setTo(value ? String(Math.round(value[1] * 1000) / 10) : '');
  };

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    if (!spans.length || (event.button !== 0 && event.button !== 2)) {
      return;
    }

    dragRef.current = {
      x: event.clientX,
      point: locate(event),
      button: event.button,
      domain,
    };
    if (hoverLineRef.current) {
      hoverLineRef.current.hidden = true;
    }
  }

  function updateDrag(event: PointerEvent<HTMLDivElement>) {
    updateHover(event);
    const start = dragRef.current;
    if (!start || Math.abs(event.clientX - start.x) < dragThresholdPx) {
      return;
    }

    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (start.button === 0) {
      setDraft(bounds(start.point, locate(event)));
    } else {
      const size = start.domain[1] - start.domain[0];
      move(
        start.domain[0] - ((event.clientX - start.x) / event.currentTarget.clientWidth) * size,
        size,
      );
    }
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    dragRef.current = null;
    updateHover(event);
    setDraft(undefined);
    if (!start) {
      return;
    }

    const moved = Math.abs(event.clientX - start.x) >= dragThresholdPx;
    if (start.button === 2) {
      if (!moved) {
        setRange();
      }
      return;
    }
    if (moved) {
      setRange(bounds(start.point, locate(event)));
      return;
    }
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-span-key]') : null;
    if (target?.dataset.spanKey) {
      setRange();
      onSelect(target.dataset.spanKey);
    }
  }

  const overlay = draft ?? range;

  return (
    <TrajectoryTimelineFrame>
      <div
        ref={plotRef}
        role="group"
        aria-label="Timeline overview"
        tabIndex={0}
        className={`relative cursor-crosshair touch-pan-y overflow-hidden select-none ${trajectoryPlotSize}`}
        onContextMenu={(event) => event.preventDefault()}
        onDoubleClick={() => setRange()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && range) {
            event.stopPropagation();
            setRange();
          }
        }}
        onPointerDown={beginDrag}
        onPointerMove={updateDrag}
        onPointerCancel={() => {
          dragRef.current = null;
          setDraft(undefined);
          if (hoverLineRef.current) {
            hoverLineRef.current.hidden = true;
          }
        }}
        onPointerLeave={(event) => {
          if (hoverLineRef.current) {
            hoverLineRef.current.hidden = true;
          }
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
            dragRef.current = null;
          }
        }}
        onPointerUp={finishDrag}
      >
        <div
          ref={hoverLineRef}
          hidden
          aria-hidden="true"
          data-timeline-hover-line
          className={guideLineClass}
        />
        {!spans.length && <p className="py-1 text-xs text-muted-foreground">No timing data</p>}
        {overlay && (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 bg-primary/10"
              style={{
                left: `${toPercent(overlay[0])}%`,
                width: `${((overlay[1] - overlay[0]) / width) * 100}%`,
              }}
            />
            {(['start', 'end'] as const).map((edge) => (
              <div
                key={edge}
                aria-hidden="true"
                data-timeline-range-edge
                className={guideLineClass}
                style={{ left: `${toPercent(overlay[edge === 'start' ? 0 : 1])}%` }}
              />
            ))}
          </>
        )}
        <div className="pointer-events-none absolute inset-x-0 inset-y-1" aria-hidden="true">
          {spans.map(
            ({ boundary, key, start }) =>
              boundary &&
              start >= domain[0] &&
              start <= domain[1] && (
                <div
                  key={key}
                  className="absolute -inset-y-1 w-px bg-border"
                  style={{ left: `${toPercent(start)}%` }}
                />
              ),
          )}
          {spans.map((span) => {
            if (span.end < domain[0] || span.start > domain[1]) {
              return null;
            }
            const role = trajectoryRoles[span.record.kind];
            const start = toPercent(span.start);
            const length = toPercent(span.end) - start;
            const gap = `min(1px, ${length * 0.08}%)`;
            const failure =
              (span.record.kind === 'assistant' || span.record.kind === 'tool') &&
              span.record.status === 'failed';
            const dim =
              (matches && !matches.has(span.key)) ||
              (overlay && (span.end < overlay[0] || span.start > overlay[1]));
            return (
              <Tooltip key={span.key}>
                <TooltipTrigger
                  render={
                    <span
                      data-span-key={span.key}
                      className={`pointer-events-auto absolute h-2 min-w-0.5 -translate-y-1/2 ${failure ? 'bg-destructive' : role.mark} ${dim ? 'opacity-25' : ''} ${selected === span.key ? 'z-10 outline-1 outline-offset-1 outline-ring' : ''}`}
                      style={{
                        left: span.markOnly
                          ? `clamp(0%, calc(${start}% - 1px), calc(100% - 2px))`
                          : `min(calc(100% - 2px), calc(${start}% + ${gap}))`,
                        width: span.markOnly
                          ? '2px'
                          : `max(2px, calc(${length}% - ${gap} - ${gap}))`,
                        top: `${((role.lane + 0.5) / trajectoryLanes.length) * 100}%`,
                      }}
                    >
                      {span.firstOutputFraction && !span.markOnly && (
                        <span
                          className="pointer-events-none block h-full bg-background/40"
                          style={{
                            width: `${span.firstOutputFraction * 100}%`,
                          }}
                        />
                      )}
                    </span>
                  }
                />
                <TooltipContent side="bottom">
                  {role.label} · {recordTitle(span.record)}
                  {span.record.timestamp &&
                    ` · ${new Date(span.record.timestamp).toLocaleTimeString()}`}
                  {span.duration !== undefined && ` · ${durationText(span.duration)}`}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
      <TimelineControls
        domain={domain}
        range={range}
        from={from}
        to={to}
        setFrom={setFrom}
        setTo={setTo}
        move={move}
        zoom={zoom}
        resetZoom={() => setDomain(full)}
        setRange={setRange}
      />
    </TrajectoryTimelineFrame>
  );
}

function TimelineControls({
  domain,
  range,
  from,
  to,
  setFrom,
  setTo,
  move,
  zoom,
  resetZoom,
  setRange,
}: {
  domain: TimeRange;
  range?: TimeRange;
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  move: (start: number, size: number) => void;
  zoom: (factor: number) => void;
  resetZoom: () => void;
  setRange: (range?: TimeRange) => void;
}) {
  const width = domain[1] - domain[0];
  const fromValue = Number(from);
  const toValue = Number(to);
  const validRange =
    from !== '' && to !== '' && fromValue >= 0 && toValue <= 100 && fromValue < toValue;
  return (
    <Popover>
      <PopoverTrigger render={<TimelineControlButton />} />
      <PopoverContent align="end" className="max-w-[calc(100vw-2rem)]">
        <PopoverTitle>Timeline controls</PopoverTitle>
        <div className="flex flex-wrap gap-1">
          <Button
            variant="outline"
            size="xs"
            className="touch-target"
            disabled={width <= minimumDomainWidth}
            onClick={() => zoom(0.5)}
          >
            Zoom in
          </Button>
          <Button
            variant="outline"
            size="xs"
            className="touch-target"
            disabled={width === 1}
            onClick={() => zoom(2)}
          >
            Zoom out
          </Button>
          <Button
            variant="outline"
            size="xs"
            className="touch-target"
            disabled={domain[0] === 0}
            onClick={() => move(domain[0] - width / 2, width)}
          >
            Earlier
          </Button>
          <Button
            variant="outline"
            size="xs"
            className="touch-target"
            disabled={domain[1] >= 1}
            onClick={() => move(domain[0] + width / 2, width)}
          >
            Later
          </Button>
          <Button variant="ghost" size="xs" className="touch-target" onClick={resetZoom}>
            Reset zoom
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field className="gap-1">
            <FieldLabel htmlFor="trajectory-range-start">Start (%)</FieldLabel>
            <Input
              id="trajectory-range-start"
              className="touch-target"
              type="number"
              min={0}
              max={100}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field className="gap-1">
            <FieldLabel htmlFor="trajectory-range-end">End (%)</FieldLabel>
            <Input
              id="trajectory-range-end"
              className="touch-target"
              type="number"
              min={0}
              max={100}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
        </div>
        <div className="flex gap-1">
          <Button
            size="xs"
            className="touch-target"
            disabled={!validRange}
            onClick={() => setRange([fromValue / 100, toValue / 100])}
          >
            Focus range
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="touch-target"
            disabled={!range}
            onClick={() => setRange()}
          >
            Clear range
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
