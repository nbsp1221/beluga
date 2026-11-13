import type { ComponentProps, ReactNode, Ref } from 'react';
import { Button } from '@workspace/ui/components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group';
import { Clock3, Columns2, Search, SlidersHorizontal } from 'lucide-react';

export const trajectoryLanes = ['Input', 'Model', 'Tools'];

export const trajectoryPlotSize = 'min-h-12 min-w-0 flex-1';
export const trajectoryRowHeight = 'h-8 max-md:h-13';

type ToolbarControls = {
  duration: boolean;
  turnsFolded: boolean;
  callsFolded: boolean;
  hasTurns: boolean;
  hasCalls: boolean;
  search: Ref<HTMLInputElement>;
  query: string;
  toggleDuration: () => void;
  toggleTurns: () => void;
  toggleCalls: () => void;
  onSearch: (value: string) => void;
};

export function TrajectoryToolbar({ controls }: { controls?: ToolbarControls }) {
  return (
    <div
      role="toolbar"
      aria-label="Trajectory toolbar"
      className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b bg-muted/30 px-2 py-1"
    >
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          className="touch-target aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          aria-pressed={controls?.duration ?? false}
          disabled={!controls}
          onClick={controls?.toggleDuration}
        >
          <Clock3 />
          Duration
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="touch-target aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          aria-pressed={controls?.turnsFolded ?? false}
          disabled={!controls?.hasTurns}
          onClick={controls?.toggleTurns}
        >
          <Columns2 />
          Turns
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="touch-target aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          aria-pressed={controls?.callsFolded ?? false}
          disabled={!controls?.hasCalls}
          onClick={controls?.toggleCalls}
        >
          <Columns2 />
          Calls
        </Button>
      </div>
      <InputGroup className="ml-auto w-44 max-w-full max-md:h-11">
        <InputGroupAddon>
          <Search className="size-3" />
        </InputGroupAddon>
        <InputGroupInput
          ref={controls?.search}
          type="search"
          aria-label="Search trajectory"
          placeholder="Search"
          disabled={!controls}
          onChange={(event) => controls?.onSearch(event.target.value)}
          value={controls?.query ?? ''}
        />
      </InputGroup>
    </div>
  );
}

export function TrajectoryTimelineFrame({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Trajectory timeline"
      className="flex shrink-0 items-stretch border-b bg-muted/50"
    >
      <div
        className="grid w-12 shrink-0 grid-rows-3 items-center border-e py-1 pe-1 text-end text-xs leading-none text-muted-foreground"
        aria-hidden="true"
      >
        {trajectoryLanes.map((lane) => (
          <span key={lane}>{lane}</span>
        ))}
      </div>
      {children}
    </section>
  );
}

export function TimelineControlButton(props: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="m-1 touch-target shrink-0"
      aria-label="Timeline controls"
      {...props}
    >
      <SlidersHorizontal />
    </Button>
  );
}
