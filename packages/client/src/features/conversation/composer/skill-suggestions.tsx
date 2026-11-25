import { type SkillSummary, explicitSkillName } from '@workspace/protocol/host';
import { Button } from '@workspace/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover';
import { type KeyboardEvent, useEffect, useId, useState } from 'react';
import type { ConversationClient, Session } from '../contract.js';

export function useSkillSuggestions(
  client: ConversationClient,
  session: Session,
  enabled: boolean,
) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [result, setResult] = useState<{ key: string; items: readonly SkillSummary[] }>();
  const query = /^\/([a-z0-9-]*)$/.exec(session.draft)?.[1];
  const open = enabled && focused && !dismissed && query !== undefined;
  const { id, workspaceId, agentPresetId, agentPresetVersion, isDraft } = session;
  const key = JSON.stringify([id, workspaceId, agentPresetId, agentPresetVersion, isDraft]);

  useEffect(() => {
    if (!open || !client.listSkills) {
      return;
    }
    const abort = new AbortController();
    const scope = { id, workspaceId, agentPresetId, agentPresetVersion, isDraft };
    void client
      .listSkills(scope, abort.signal)
      .then((items) => {
        if (!abort.signal.aborted) {
          setResult({ key, items });
        }
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [client, open, key, id, workspaceId, agentPresetId, agentPresetVersion, isDraft]);

  const items =
    open && result?.key === key
      ? result.items
          .filter(
            ({ name, description }) =>
              name.includes(query) || description.toLowerCase().includes(query),
          )
          .slice(0, 30)
      : [];
  const current = Math.min(index, items.length - 1);

  useEffect(() => {
    if (current < 0) {
      return;
    }
    document.getElementById(`${listId}-${current}`)?.scrollIntoView({ block: 'nearest' });
  }, [current, key, listId]);

  function dismiss() {
    setDismissed(true);
    setResult(undefined);
  }

  function select(name: string) {
    client.setDraft(id, `/${name} `);
    setSelected(name);
    dismiss();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!items.length || event.nativeEvent.isComposing) {
      return false;
    }
    if (event.key === 'Escape') {
      dismiss();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      setIndex((current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      select(items[current].name);
    } else {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  return {
    listId,
    items,
    current,
    selected: explicitSkillName(session.draft) === selected ? selected : undefined,
    select,
    setFocused(focused: boolean) {
      setFocused(focused);
      if (!focused) {
        setResult(undefined);
      }
    },
    dismiss,
    changed(text: string) {
      setIndex(0);
      setDismissed(false);
      if (!/^\/[a-z0-9-]*$/.test(text)) {
        setResult(undefined);
      }
      if (explicitSkillName(text) !== selected) {
        setSelected(undefined);
      }
    },
    keyDown,
  };
}

export function SkillSuggestions({
  suggestions,
}: {
  suggestions: ReturnType<typeof useSkillSuggestions>;
}) {
  const { items, current, listId, select } = suggestions;
  return (
    <Popover
      open={items.length > 0}
      onOpenChange={(open) => {
        if (!open) {
          suggestions.dismiss();
        }
      }}
    >
      <PopoverTrigger type="button" tabIndex={-1} aria-hidden="true" className="sr-only" />
      <PopoverContent side="top" align="start" initialFocus={false} finalFocus={false}>
        <div id={listId} role="listbox" aria-label="Skills" className="max-h-48 overflow-y-auto">
          {items.map(({ name, description, userOnly }, index) => (
            <Button
              id={`${listId}-${index}`}
              key={name}
              type="button"
              role="option"
              aria-selected={index === current}
              tabIndex={-1}
              variant={index === current ? 'secondary' : 'ghost'}
              className="h-auto w-full flex-col items-start gap-0.5 text-left whitespace-normal"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(name)}
            >
              <span>
                {name}
                {userOnly && ' · Manual only'}
              </span>
              <span className="text-muted-foreground">{description}</span>
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
