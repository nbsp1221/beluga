import type { WorkspaceInstructionChanges } from '@workspace/protocol/host';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@workspace/ui/components/trace';
import { FileText } from 'lucide-react';

export function ContextLine({
  changes,
  text,
}: {
  changes: WorkspaceInstructionChanges;
  text: string;
}) {
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger className="touch-target">
        <TraceLine>
          <TraceIcon>
            <FileText />
          </TraceIcon>
          <TraceTitle>
            Workspace instructions · {changes.map(({ path }) => path).join(', ')}
          </TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <pre className="max-h-40 overflow-y-auto text-xs break-words whitespace-pre-wrap">
          {text}
        </pre>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
