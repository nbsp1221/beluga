import { Spinner } from '@workspace/ui/components/spinner';
import {
  TimelineControlButton,
  TrajectoryTimelineFrame,
  TrajectoryToolbar,
  trajectoryPlotSize,
  trajectoryRowHeight,
} from './frame.js';

export function TrajectoryLoading() {
  return (
    <p
      role="status"
      className={`flex items-center justify-center gap-1.5 border-b bg-background px-2 text-xs text-muted-foreground ${trajectoryRowHeight}`}
    >
      <Spinner className="shrink-0 motion-reduce:animate-none" aria-hidden="true" />
      Loading trajectory…
    </p>
  );
}

export function TrajectoryViewLoading() {
  return (
    <section aria-label="Trajectory" className="flex h-full min-h-0 min-w-0 flex-col">
      <div inert className="shrink-0">
        <TrajectoryToolbar />
        <TrajectoryTimelineFrame>
          <div className={trajectoryPlotSize} />
          <TimelineControlButton disabled />
        </TrajectoryTimelineFrame>
      </div>
      <div aria-label="Trajectory records" className="min-h-0 flex-1">
        <TrajectoryLoading />
      </div>
    </section>
  );
}
