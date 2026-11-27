import type { SkillListing } from '@workspace/protocol/host';
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
  const [result, setResult] = useState<{ key: string; listing: SkillListing | null }>();
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
      .then((listing) => {
        if (!abort.signal.aborted) {
          setResult({ key, listing });
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setResult({ key, listing: null });
        }
      });
    return () => abort.abort();
  }, [client, open, key, id, workspaceId, agentPresetId, agentPresetVersion, isDraft]);

  const listing = open && result?.key === key ? result.listing : undefined;
  const items = listing ? matchingSkills(listing.items, query ?? '') : [];
  const current = Math.min(index, items.length - 1);
  const notice =
    listing === null
      ? 'Skills could not be loaded.'
      : listing?.incomplete
        ? 'Some skills could not be listed.'
        : '';
  const announcement = [
    notice,
    listing && (items.length ? `${items.length} skill suggestions.` : 'No matching skills.'),
  ]
    .filter(Boolean)
    .join(' ');

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

  function select({ name }: SkillListing['items'][number]) {
    client.setDraft(id, `/${name} `);
    dismiss();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((!items.length && !notice) || event.nativeEvent.isComposing) {
      return false;
    }
    if (event.key === 'Escape') {
      dismiss();
    } else if (items.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setIndex((current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if (items.length && (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      select(items[current]);
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
    notice,
    announcement,
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
    },
    keyDown,
  };
}

function matchingSkills(items: SkillListing['items'], query: string) {
  if (!query) {
    return items.slice(0, 30);
  }
  const matches = items.flatMap((item) => {
    const { name, description } = item;
    if (name === query) {
      return [{ item, rank: 0 }];
    }
    if (name.startsWith(query)) {
      return [{ item, rank: 1 }];
    }
    if (name.includes(query)) {
      return [{ item, rank: 2 }];
    }
    if (description.toLowerCase().includes(query)) {
      return [{ item, rank: 3 }];
    }
    return [];
  });
  return matches
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 30)
    .map(({ item }) => item);
}

export function SkillSuggestions({
  suggestions,
}: {
  suggestions: ReturnType<typeof useSkillSuggestions>;
}) {
  const { items, current, listId, select, notice, announcement } = suggestions;
  return (
    <>
      <span role="status" className="sr-only">
        {announcement}
      </span>
      <Popover
        open={items.length > 0 || Boolean(notice)}
        onOpenChange={(open) => {
          if (!open) {
            suggestions.dismiss();
          }
        }}
      >
        <PopoverTrigger type="button" tabIndex={-1} aria-hidden="true" className="sr-only" />
        <PopoverContent side="top" align="start" initialFocus={false} finalFocus={false}>
          {notice && (
            <p aria-hidden="true" className="px-2 py-1 text-sm text-muted-foreground">
              {notice}
            </p>
          )}
          {items.length > 0 && (
            <div
              id={listId}
              role="listbox"
              aria-label="Skills"
              className="max-h-48 overflow-y-auto"
            >
              {items.map((item, index) => (
                <Button
                  id={`${listId}-${index}`}
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={index === current}
                  tabIndex={-1}
                  variant={index === current ? 'secondary' : 'ghost'}
                  className="h-auto w-full flex-col items-start gap-0.5 text-left whitespace-normal"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(item)}
                >
                  <span>
                    {item.name}
                    {item.userOnly && ' · Manual only'}
                  </span>
                  <span className="text-muted-foreground">{item.description}</span>
                </Button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
