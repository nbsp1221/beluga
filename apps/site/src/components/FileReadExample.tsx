import { ToolLine } from '@workspace/client/chat/tool-line';
import { Trace } from '@workspace/ui/components/trace';
import { exampleFileRead } from './example-conversation';

export function FileReadExample() {
  return (
    <Trace className="gap-3 rounded-xl border border-border bg-background p-4 text-foreground shadow-xl">
      <ToolLine part={exampleFileRead} defaultOpen />
    </Trace>
  );
}
