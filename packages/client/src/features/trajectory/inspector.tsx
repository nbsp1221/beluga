import type {
  TrajectoryModelInputResponse,
  TrajectoryRecord,
  TrajectoryRequest,
} from '@workspace/protocol/host';
import { Button } from '@workspace/ui/components/button';
import { PaneTabsList } from '@workspace/ui/components/pane-tabs-list';
import { Tabs, TabsContent, TabsTrigger } from '@workspace/ui/components/tabs';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TrajectoryClient } from './contract.js';
import { durationText, payloadText, resultText, statusLabels } from './records.js';

const tabBody =
  'min-h-0 overflow-y-auto px-3 pt-3 pb-[calc(0.75rem+var(--conversation-composer-clearance,0px))] text-xs';

const timestamps = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
});

function timestamp(value?: string) {
  return value && Number.isFinite(Date.parse(value))
    ? timestamps.format(new Date(value))
    : 'Unavailable';
}

function JsonValue({ value, label }: { value: unknown; label?: string }) {
  if (!value || typeof value !== 'object') {
    return (
      <div className="min-w-0 break-words">
        {label && <span className="text-muted-foreground">{label}: </span>}
        {payloadText(value)}
      </div>
    );
  }
  const items = Object.entries(value);
  return (
    <details open={label === undefined}>
      <summary className="cursor-pointer">
        {label && `${label}: `}
        {Array.isArray(value) ? `Array (${items.length})` : `Object (${items.length})`}
      </summary>
      <div className="border-l pl-3">
        {items.map(([key, item]) => (
          <JsonValue key={key} label={key} value={item} />
        ))}
      </div>
    </details>
  );
}

function Payload({ value, empty }: { value: unknown; empty: string }) {
  if (value === undefined) {
    return <p className="text-muted-foreground">{empty}</p>;
  }
  return typeof value === 'object' && value !== null ? (
    <div className="min-w-0 font-mono text-xs leading-relaxed">
      <JsonValue value={value} />
    </div>
  ) : (
    <pre className="min-w-0 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
      {payloadText(value)}
    </pre>
  );
}

function DetailSection({
  title,
  onOpen,
  children,
}: {
  title: string;
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      {onOpen ? (
        <Button size="xs" variant="ghost" className="-ml-2 touch-target" onClick={onOpen}>
          {title}
          <ChevronRight />
        </Button>
      ) : (
        <h3 className="font-medium">{title}</h3>
      )}
      {children}
    </section>
  );
}

function RequestInput({
  input,
  section,
}: {
  input: TrajectoryModelInputResponse;
  section: string;
}) {
  const messages = input.messageIds.map((id, index) => ({ id, message: input.messages[index] }));

  return (
    <div className="space-y-4">
      {section !== 'Tools' && (
        <DetailSection title="System Prompt">
          <Payload value={input.systemPrompt} empty="No system prompt" />
        </DetailSection>
      )}
      {section === 'Input' && (
        <DetailSection title="Messages">
          {messages.length ? (
            messages.map(({ id, message }, index) => {
              const role =
                message &&
                typeof message === 'object' &&
                'role' in message &&
                typeof message.role === 'string'
                  ? message.role
                  : 'Message';
              return (
                <details key={id} className="border-b py-1">
                  <summary className="touch-target cursor-pointer">
                    {index + 1}. {role}
                  </summary>
                  <Payload value={message} empty="Message unavailable" />
                </details>
              );
            })
          ) : (
            <p className="text-muted-foreground">No messages</p>
          )}
        </DetailSection>
      )}
      {section !== 'System Prompt' && (
        <DetailSection title="Tools">
          {input.tools.length ? (
            input.tools.map((tool) => (
              <details key={tool.name} className="border-b py-1">
                <summary className="touch-target cursor-pointer font-mono">{tool.name}</summary>
                {tool.description && <p className="py-1">{tool.description}</p>}
                <Payload value={tool.parameters} empty="Schema unavailable" />
              </details>
            ))
          ) : (
            <p className="text-muted-foreground">No tools</p>
          )}
        </DetailSection>
      )}
    </div>
  );
}

function inspectorTabs(record: TrajectoryRecord | undefined, modelRequest: boolean): string[] {
  if (record?.kind === 'system') {
    return ['System Prompt', 'Tools'];
  }
  if (record?.kind === 'tool') {
    const payloadTab = record.input === undefined ? [] : ['Payload'];
    return ['Summary', ...payloadTab, 'Result', 'Schema', 'Timing'];
  }

  const usageTab = record?.kind === 'assistant' && record.usage ? ['Usage'] : [];
  if (modelRequest) {
    return ['Summary', 'Input', ...usageTab, 'Timing'];
  }
  if (record?.kind === 'assistant') {
    return ['Summary', 'Preview', 'Raw', ...usageTab, 'Timing'];
  }
  if (record?.kind === 'user') {
    return ['Summary', 'Preview', 'Raw'];
  }

  return ['Summary', 'Timing'];
}

function CompactionSummary({
  record,
  request,
  onModelRequest,
}: {
  record: Extract<TrajectoryRecord, { kind: 'compaction' }>;
  request: TrajectoryRequest;
  onModelRequest: (record: TrajectoryRecord) => void;
}) {
  const summaryRequests = request.records.filter(
    (item): item is Extract<TrajectoryRecord, { kind: 'assistant' }> =>
      item.kind === 'assistant' && item.compactionId === record.id,
  );
  return (
    <>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Trigger</dt>
        <dd>
          {
            { threshold: 'Context threshold', overflow: 'Context overflow', manual: 'Manual' }[
              record.reason
            ]
          }
        </dd>
        <dt className="text-muted-foreground">Estimated context before</dt>
        <dd>{record.estimatedTokens.toLocaleString()} tokens</dd>
        {record.summaryTokens !== undefined && (
          <>
            <dt className="text-muted-foreground">Summary usage</dt>
            <dd>{record.summaryTokens.toLocaleString()} tokens</dd>
          </>
        )}
        {record.messagesBefore !== undefined && record.messagesAfter !== undefined && (
          <>
            <dt className="text-muted-foreground">Messages</dt>
            <dd>
              {record.messagesBefore} → {record.messagesAfter}
            </dd>
          </>
        )}
      </dl>
      {record.error && <p className="break-words text-destructive">{record.error}</p>}
      {summaryRequests.length > 0 && (
        <DetailSection title="Summary requests">
          {summaryRequests.map((item) => (
            <Button
              key={item.id}
              size="xs"
              variant="link"
              className="touch-target"
              onClick={() => onModelRequest(item)}
            >
              {item.purpose === 'compaction_prefix' ? 'Turn prefix summary' : 'History summary'}
              <ChevronRight />
            </Button>
          ))}
        </DetailSection>
      )}
    </>
  );
}

export function TrajectoryInspector({
  sessionId,
  loadModelInput,
  record,
  request,
  modelRequest,
  activeTab,
  onTab,
  onTurn,
  onRecord,
  onModelRequest,
}: {
  sessionId: string;
  loadModelInput?: TrajectoryClient['loadModelInput'];
  record?: TrajectoryRecord;
  request: TrajectoryRequest;
  modelRequest: boolean;
  activeTab: string;
  onTab: (tab: string) => void;
  onTurn: () => void;
  onRecord: (record: TrajectoryRecord) => void;
  onModelRequest: (record: TrajectoryRecord) => void;
}) {
  const tool = record?.kind === 'tool' ? record : undefined;
  const model = record?.kind === 'assistant' ? record : undefined;
  const system = record?.kind === 'system' ? record : undefined;
  const compaction = record?.kind === 'compaction' ? record : undefined;
  const message = record?.kind === 'user' || record?.kind === 'assistant' ? record : undefined;
  const status = tool?.status ?? model?.status ?? compaction?.status ?? request.status;
  const parent = tool && request.records.find(({ id }) => id === tool.modelRequestId);
  const linkedModelRequest = parent ?? (modelRequest ? undefined : model);
  const error = tool?.error ?? compaction?.error ?? (!record ? request.error : undefined);

  const tabs = inspectorTabs(record, modelRequest);
  const currentTab = tabs.includes(activeTab) ? activeTab : tabs[0];

  const inputId = system?.modelRequestId ?? model?.id;
  const inputKey = `${request.id}/${inputId}`;
  const needsInput =
    currentTab === 'Input' || currentTab === 'System Prompt' || currentTab === 'Tools';
  const [loadedInput, setLoadedInput] = useState<{
    key: string;
    value?: TrajectoryModelInputResponse;
  }>();

  useEffect(() => {
    if (!needsInput || !inputId || !loadModelInput || loadedInput?.key === inputKey) {
      return;
    }
    const controller = new AbortController();
    void loadModelInput(sessionId, request.id, inputId, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) {
          setLoadedInput({ key: inputKey, value });
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setLoadedInput({ key: inputKey });
        }
      },
    );
    return () => controller.abort();
  }, [inputId, inputKey, loadModelInput, loadedInput?.key, needsInput, request.id, sessionId]);

  const inputContent =
    loadedInput?.key === inputKey && loadedInput.value ? (
      <RequestInput input={loadedInput.value} section={currentTab} />
    ) : (
      <p role="status" className="text-muted-foreground">
        {loadModelInput && loadedInput?.key !== inputKey
          ? 'Loading model input…'
          : 'Model input unavailable'}
      </p>
    );

  const timing = (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 tabular-nums">
      <dt className="text-muted-foreground">{record?.kind === 'user' ? 'Recorded' : 'Started'}</dt>
      <dd>
        {timestamp(record?.timestamp ?? (!record ? request.records[0]?.timestamp : undefined))}
      </dd>
      {(tool || model || compaction) && (
        <>
          <dt className="text-muted-foreground">Duration</dt>
          <dd>{durationText(tool?.durationMs ?? model?.durationMs ?? compaction?.durationMs)}</dd>
          <dt className="text-muted-foreground">Finished</dt>
          <dd>{timestamp(tool?.endedAt ?? model?.endedAt ?? compaction?.endedAt)}</dd>
        </>
      )}
      {model?.firstOutputAt && model.timestamp && (
        <>
          <dt className="text-muted-foreground">First observed output</dt>
          <dd>{durationText(Date.parse(model.firstOutputAt) - Date.parse(model.timestamp))}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Turn settled</dt>
      <dd>{timestamp(request.settledAt)}</dd>
    </dl>
  );

  const recordedResult = resultText(tool?.output);
  const result = (
    <div className="space-y-2">
      {error && <p className="break-words text-destructive">{error}</p>}
      {(!error || (recordedResult && recordedResult !== error)) && (
        <Payload
          value={recordedResult}
          empty={status === 'in-progress' ? 'Running…' : 'Result unavailable'}
        />
      )}
    </div>
  );

  const preview = (
    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
      {message?.text ||
        (status === 'in-progress'
          ? 'Waiting for output…'
          : status === 'completed'
            ? 'Tool call only'
            : statusLabels[status])}
    </p>
  );

  const usage = model?.usage && (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tabular-nums">
      {Object.entries(model.usage).map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label.replace(/([a-z])([A-Z])/g, '$1 $2')}</dt>
          <dd>{value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <Tabs className="min-h-0 flex-1 gap-0" value={currentTab} onValueChange={onTab}>
      <PaneTabsList railClassName="border-b px-2" aria-label="Record details">
        {tabs.map((tab) => (
          <TabsTrigger key={tab} value={tab} className="touch-target flex-none">
            {tab}
          </TabsTrigger>
        ))}
      </PaneTabsList>
      <TabsContent value="Summary" className={`${tabBody} space-y-3`}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1">
          {record && (
            <>
              <dt className="text-muted-foreground">Hierarchy</dt>
              <dd>
                <Button size="xs" variant="link" className="touch-target px-0" onClick={onTurn}>
                  Turn
                  <ChevronRight />
                </Button>
                {linkedModelRequest && (
                  <Button
                    size="xs"
                    variant="link"
                    className="touch-target"
                    onClick={() => onModelRequest(linkedModelRequest)}
                  >
                    Model request
                    <ChevronRight />
                  </Button>
                )}
              </dd>
            </>
          )}
          {record?.kind !== 'user' && (
            <>
              <dt className="text-muted-foreground">Status</dt>
              <dd className={status === 'failed' ? 'text-destructive' : undefined}>
                {statusLabels[status]}
              </dd>
            </>
          )}
          {modelRequest && model?.model && (
            <>
              <dt className="text-muted-foreground">Model</dt>
              <dd>{model.model}</dd>
            </>
          )}
          {modelRequest && model?.provider && (
            <>
              <dt className="text-muted-foreground">Provider</dt>
              <dd>{model.provider}</dd>
            </>
          )}
          {model?.contextCompacted && (
            <>
              <dt className="text-muted-foreground">Context</dt>
              <dd>Includes a compaction summary</dd>
            </>
          )}
          {modelRequest && model?.text && (
            <>
              <dt className="text-muted-foreground">Result</dt>
              <dd>
                <Button
                  size="xs"
                  variant="link"
                  className="touch-target px-0"
                  onClick={() => onRecord(model)}
                >
                  {model.compactionId ? 'Summary result' : 'Assistant message'}
                  <ChevronRight />
                </Button>
              </dd>
            </>
          )}
          {!record && (
            <>
              <dt className="text-muted-foreground">Tool calls</dt>
              <dd>{request.records.filter((item) => item.kind === 'tool').length}</dd>
            </>
          )}
        </dl>
        {compaction && (
          <CompactionSummary
            record={compaction}
            request={request}
            onModelRequest={onModelRequest}
          />
        )}
        {message && !modelRequest && preview}
        {!record && (
          <DetailSection title="Records">
            <ul>
              {request.records.map((item) => (
                <li key={item.id}>
                  <Button
                    size="xs"
                    variant="link"
                    className="touch-target px-0"
                    onClick={() => onRecord(item)}
                  >
                    {item.kind === 'tool' ? item.name : item.kind}
                    <ChevronRight />
                  </Button>
                </li>
              ))}
            </ul>
            {error && <p className="text-destructive">{error}</p>}
          </DetailSection>
        )}
        {tool?.input !== undefined && (
          <DetailSection title="Payload" onOpen={() => onTab('Payload')}>
            <Payload value={tool.input} empty="Payload unavailable" />
          </DetailSection>
        )}
        {tool && (
          <>
            <DetailSection title="Result" onOpen={() => onTab('Result')}>
              {result}
            </DetailSection>
            <DetailSection title="Schema" onOpen={() => onTab('Schema')}>
              <Payload value={tool.schema} empty="Schema unavailable" />
            </DetailSection>
          </>
        )}
        {usage && (
          <DetailSection title="Usage" onOpen={() => onTab('Usage')}>
            {usage}
          </DetailSection>
        )}
        {record?.kind !== 'user' && (
          <DetailSection title="Timing" onOpen={() => onTab('Timing')}>
            {timing}
          </DetailSection>
        )}
      </TabsContent>
      <TabsContent value="Preview" className={tabBody}>
        {preview}
      </TabsContent>
      {needsInput && (
        <TabsContent value={currentTab} className={tabBody}>
          {inputContent}
        </TabsContent>
      )}
      <TabsContent value="Raw" className={tabBody}>
        <Payload value={message?.text} empty="Text unavailable" />
      </TabsContent>
      <TabsContent value="Payload" className={tabBody}>
        <Payload value={tool?.input} empty="Payload unavailable" />
      </TabsContent>
      <TabsContent value="Result" className={tabBody}>
        <DetailSection title="Result">{result}</DetailSection>
        {tool?.output !== undefined && typeof tool.output === 'object' && (
          <DetailSection title="Recorded payload">
            <Payload value={tool.output} empty="Result unavailable" />
          </DetailSection>
        )}
      </TabsContent>
      <TabsContent value="Schema" className={tabBody}>
        <Payload value={tool?.schema} empty="Schema unavailable" />
      </TabsContent>
      <TabsContent value="Usage" className={tabBody}>
        {usage}
      </TabsContent>
      <TabsContent value="Timing" className={tabBody}>
        {timing}
      </TabsContent>
    </Tabs>
  );
}
