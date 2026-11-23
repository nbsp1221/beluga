import type { ConversationActivity } from '@workspace/protocol/host';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible';
import { DisclosureButton } from '@workspace/ui/components/disclosure-button';
import { Separator } from '@workspace/ui/components/separator';
import { ChevronDown } from 'lucide-react';
import type { Workspace } from '../../workspaces/contract.js';
import type { Session } from '../contract.js';
import { SessionRow } from './session-row.js';
import { workspaceLabel } from './workspace-label.js';

type ActivityRow = {
  session: Session;
  lastActivityAt: string;
  running: boolean;
  unread: boolean;
};

export function SessionActivity({
  sessions,
  workspaces,
  currentId,
  activity,
  onOpen,
}: {
  sessions: readonly Session[];
  workspaces: readonly Workspace[];
  currentId: string | undefined;
  activity: ConversationActivity | undefined;
  onOpen: () => void;
}) {
  const groups: Record<'Done' | 'Working' | 'Idle', ActivityRow[]> = {
    Done: [],
    Working: [],
    Idle: [],
  };
  for (const session of sessions) {
    const state = activity?.[session.id];
    if (!session.isDraft && state) {
      const { running, lastActivityAt, unreadCompletion } = state;
      const unread = Boolean(unreadCompletion);
      const group = running ? 'Working' : unread ? 'Done' : 'Idle';
      groups[group].push({ session, lastActivityAt, running, unread });
    }
  }
  const visibleGroups = Object.entries(groups).filter(([, rows]) => rows.length > 0);

  return (
    <>
      <Separator className="my-2" />
      <section aria-label="Activity" className="flex max-h-1/2 min-h-0 shrink-0 flex-col gap-1">
        <h2 className="flex min-h-9 shrink-0 items-center px-2 text-xs font-medium text-muted-foreground">
          Activity
        </h2>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {visibleGroups.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">No recent activity.</p>
          )}
          {visibleGroups.map(([label, rows]) => (
            <Collapsible key={label} defaultOpen render={<section aria-label={label} />}>
              <CollapsibleTrigger
                render={
                  <DisclosureButton
                    size="sm"
                    className="group/activity-heading gap-2 px-2 text-xs text-muted-foreground"
                  />
                }
              >
                <span>{label}</span>
                <span>{rows.length}</span>
                <ChevronDown
                  aria-hidden="true"
                  className="ms-auto -rotate-90 group-aria-expanded/activity-heading:rotate-0"
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-0.5">
                {rows
                  .sort(
                    (a, b) =>
                      b.lastActivityAt.localeCompare(a.lastActivityAt) ||
                      b.session.id.localeCompare(a.session.id),
                  )
                  .map(({ session, running, unread }) => {
                    const workspace = workspaces.find((item) => item.id === session.workspaceId);
                    return (
                      <SessionRow
                        key={session.id}
                        session={session}
                        current={session.id === currentId}
                        running={running}
                        unread={unread}
                        workspace={workspace && workspaceLabel(workspace, workspaces)}
                        onClick={onOpen}
                      />
                    );
                  })}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </section>
    </>
  );
}
