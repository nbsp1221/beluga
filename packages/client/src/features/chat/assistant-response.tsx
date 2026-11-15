import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@workspace/ui/components/code-block';
import { CollapsibleContent } from '@workspace/ui/components/collapsible';
import { Separator } from '@workspace/ui/components/separator';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@workspace/ui/components/trace';
import { Brain, Terminal, Wrench } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { AssistantMessagePart, TurnActivity } from '../conversation/contract.js';
import { ChatMarkdown } from './chat-markdown.js';
import { MessageActions } from './message-actions.js';

export function AssistantResponse({
  parts,
  activity,
  active,
  completedAt,
  today,
  latest,
}: {
  parts: readonly AssistantMessagePart[];
  activity?: TurnActivity;
  active: boolean;
  completedAt?: number;
  today: Date;
  latest: boolean;
}) {
  const [open, setOpen] = useState<boolean>();
  const workEnd = activity ? parts.findLastIndex((part) => part.type !== 'text') + 1 : 0;
  const response = parts.slice(workEnd);
  const copyText = response
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n\n');
  const showDetails = open ?? (activity !== undefined && activity.state !== 'completed');

  return (
    <div className="flex min-w-0 flex-col gap-2.5 py-2">
      <span className="sr-only">Beluga: </span>
      {activity && (
        <Trace>
          {workEnd > 0 ? (
            <TraceCollapsible open={showDetails} onOpenChange={setOpen}>
              <TraceCollapsibleTrigger className="touch-target">
                <TurnLine activity={activity} active={active} />
              </TraceCollapsibleTrigger>
              <Separator className="mt-2" />
              <CollapsibleContent
                className="h-(--collapsible-panel-height) min-w-0 overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0"
                onFocusCapture={() => setOpen(true)}
              >
                <div className="flex flex-col gap-2.5 pt-2 pb-1 text-muted-foreground">
                  <AssistantParts parts={parts.slice(0, workEnd)} />
                </div>
              </CollapsibleContent>
            </TraceCollapsible>
          ) : (
            <>
              <TurnLine activity={activity} active={active} />
              {parts.length > 0 && <Separator />}
            </>
          )}
        </Trace>
      )}
      {response.length > 0 && (
        <div className="flex min-w-0 flex-col md:gap-1.5">
          <div className="flex min-w-0 flex-col gap-2.5">
            <AssistantParts parts={response} />
          </div>
          {copyText && (activity === undefined || activity.state === 'completed') && (
            <MessageActions
              role="assistant"
              text={copyText}
              timestamp={completedAt}
              today={today}
              alwaysVisible={latest}
            />
          )}
        </div>
      )}
    </div>
  );
}

function durationLabel(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds === 0) {
    return '<1s';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours && `${hours}h`, minutes && `${minutes}m`, remainder && `${remainder}s`]
    .filter(Boolean)
    .join(' ');
}

function TurnLine({ activity, active }: { activity: TurnActivity; active: boolean }) {
  const running = activity.state === 'running';
  const startedAt = running ? activity.startedAt : undefined;
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!active || startedAt === undefined) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  const duration = running
    ? startedAt === undefined
      ? undefined
      : Math.max(0, now - startedAt)
    : activity.durationMs;

  const label = {
    running: duration === undefined ? 'Working…' : 'Working for',
    completed: duration === undefined ? 'Completed' : 'Worked for',
    aborted: duration === undefined ? 'Stopped' : 'Stopped after',
    failed: duration === undefined ? 'Failed' : 'Failed after',
  }[activity.state];

  return (
    <TraceLine status={running ? 'running' : activity.state === 'failed' ? 'error' : undefined}>
      <TraceTitle>
        {label}
        {duration !== undefined && (
          <span aria-live={running ? 'off' : undefined}> {durationLabel(duration)}</span>
        )}
      </TraceTitle>
    </TraceLine>
  );
}

function AssistantParts({ parts }: { parts: readonly AssistantMessagePart[] }) {
  const content: ReactNode[] = [];
  let activity: ReactNode[] = [];
  let activityKey = 'activity:start';

  const flushActivity = () => {
    if (activity.length) {
      content.push(<Trace key={activityKey}>{activity}</Trace>);
      activity = [];
    }
  };

  for (const part of parts) {
    if (part.type === 'text') {
      flushActivity();
      content.push(
        <ChatMarkdown key={`text:${part.id}`} text={part.text} streaming={part.streaming} />,
      );
      activityKey = `activity:after:${part.id}`;
    } else if (part.type === 'reasoning') {
      activity.push(<ReasoningLine key={`reasoning:${part.id}`} part={part} />);
    } else {
      activity.push(<ToolLine key={`tool:${part.id}`} part={part} />);
    }
  }

  flushActivity();
  return content;
}

function ReasoningLine({ part }: { part: Extract<AssistantMessagePart, { type: 'reasoning' }> }) {
  const [open, setOpen] = useState<boolean>();
  return (
    <TraceCollapsible open={open ?? part.streaming} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger className="touch-target">
        <TraceLine status={part.streaming ? 'running' : undefined}>
          <TraceIcon>
            <Brain />
          </TraceIcon>
          <TraceTitle>{part.streaming ? 'Thinking…' : 'Thought'}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <ChatMarkdown text={part.text} streaming={part.streaming} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' && key in value
    ? Reflect.get(value, key)
    : undefined;
}

function toolText(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function ToolLine({ part }: { part: Extract<AssistantMessagePart, { type: 'tool' }> }) {
  const shell = part.name === 'bash' || part.name === 'pwsh';
  const command = shell ? field(part.input, 'command') : undefined;
  const failed = part.status === 'failed';
  const subject = typeof command === 'string' ? command : part.name;
  const label = {
    running: `Running ${subject}`,
    completed: `Ran ${subject}`,
    failed: `Failed to run ${subject}`,
    incomplete: `No result for ${subject}`,
  }[part.status];

  const line = (
    <TraceLine status={part.status === 'running' ? 'running' : failed ? 'error' : undefined}>
      <TraceIcon>{shell ? <Terminal /> : <Wrench />}</TraceIcon>
      <TraceTitle>{label}</TraceTitle>
    </TraceLine>
  );

  if (part.status === 'running') {
    return line;
  }

  const output = toolText(part.output);
  const input = typeof command === 'string' ? command : toolText(part.input);

  if (!input && !output && !part.error) {
    return line;
  }
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger className="touch-target">{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-2">
        {input && <ToolDetails title={shell ? 'Command' : 'Input'} value={input} />}
        {output && <ToolDetails title="Output" value={output} />}
        {part.error && <ToolDetails title="Error" value={part.error} />}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function ToolDetails({ title, value }: { title: string; value: string }) {
  return (
    <CodeBlock size="sm">
      <CodeBlockHeader>
        <CodeBlockTitle>{title}</CodeBlockTitle>
      </CodeBlockHeader>
      <CodeBlockContent wrap className="max-h-64">
        {value}
      </CodeBlockContent>
    </CodeBlock>
  );
}
