import { Button } from '@workspace/ui/components/button';
import { MessageFooter } from '@workspace/ui/components/message';
import { toast } from '@workspace/ui/components/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip';
import { copyText } from '@workspace/ui/lib/clipboard';
import { cn } from '@workspace/ui/lib/utils';
import { Check, Copy, GitFork, Pencil, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

function MessageTime({ timestamp, today }: { timestamp: number; today: Date }) {
  const date = new Date(timestamp);
  const clock: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const calendar: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const display = new Intl.DateTimeFormat(undefined, {
    ...clock,
    ...(date.toDateString() !== today.toDateString() && calendar),
    ...(date.getFullYear() !== today.getFullYear() && { year: 'numeric' }),
  });

  return (
    <time className="whitespace-nowrap" dateTime={date.toISOString()}>
      {display.format(date)}
    </time>
  );
}

function MessageActionButton({
  label,
  hint = label,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="touch-target"
            aria-label={label}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  );
}

// Remove this placeholder when the message actions are implemented.
function showUnavailable() {
  toast.add({ title: 'This feature is not supported yet.' });
}

export function MessageActions({
  role,
  text,
  timestamp,
  today,
  alwaysVisible = false,
}: {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: number;
  today: Date;
  alwaysVisible?: boolean;
}) {
  const [feedback, setFeedback] = useState<{ result: 'copied' | 'failed' }>();

  useEffect(() => {
    if (!feedback) {
      return;
    }
    const timeout = window.setTimeout(() => setFeedback(undefined), 2000);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  async function copy() {
    try {
      await copyText(text);
      setFeedback({ result: 'copied' });
    } catch {
      setFeedback({ result: 'failed' });
    }
  }

  const label = role === 'user' ? 'Copy message' : 'Copy response';
  const result = feedback?.result;
  const status = result === 'copied' ? 'Copied' : result === 'failed' ? 'Could not copy' : '';
  const Icon = result === 'copied' ? Check : result === 'failed' ? X : Copy;
  const time = timestamp === undefined ? null : <MessageTime timestamp={timestamp} today={today} />;

  return (
    <MessageFooter
      className={cn(
        'gap-4.5 px-0 md:gap-2.5',
        !alwaysVisible &&
          'md:group-focus-within/message:opacity-100 md:group-hover/message:opacity-100 md:[@media(hover:hover)]:opacity-0',
      )}
    >
      {role === 'user' && time}
      <div className="flex shrink-0 items-center gap-1">
        <MessageActionButton label={label} hint={status || label} onClick={() => void copy()}>
          <Icon aria-hidden="true" />
        </MessageActionButton>
        {role === 'user' ? (
          <MessageActionButton label="Edit message" onClick={showUnavailable}>
            <Pencil aria-hidden="true" />
          </MessageActionButton>
        ) : (
          <MessageActionButton label="Branch conversation" onClick={showUnavailable}>
            <GitFork aria-hidden="true" />
          </MessageActionButton>
        )}
      </div>
      {role === 'assistant' && time}
      <span role="status" className="sr-only">
        {status}
      </span>
    </MessageFooter>
  );
}
