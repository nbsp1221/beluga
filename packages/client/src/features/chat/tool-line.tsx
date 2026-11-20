import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@workspace/ui/components/code-block';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@workspace/ui/components/trace';
import { Terminal, Wrench } from 'lucide-react';
import type { AssistantMessagePart } from '../conversation/contract.js';

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' && key in value
    ? Reflect.get(value, key)
    : undefined;
}

function toolText(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function ToolLine({
  part,
  defaultOpen,
}: {
  part: Extract<AssistantMessagePart, { type: 'tool' }>;
  defaultOpen?: boolean;
}) {
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
    <TraceCollapsible defaultOpen={defaultOpen}>
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
