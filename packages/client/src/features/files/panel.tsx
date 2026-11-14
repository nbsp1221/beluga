import { Button } from '@workspace/ui/components/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible';
import { DisclosureButton } from '@workspace/ui/components/disclosure-button';
import { PaneHeader } from '@workspace/ui/components/pane-header';
import { ShellButton } from '@workspace/ui/components/shell-button';
import { ArrowLeft, ChevronDown, FileText, Folder } from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createStore } from '../../state/store.js';

const sampleFiles = [
  {
    path: 'README.md',
    text: '# Beluga\n\nA workspace for conversations and tools.',
  },
  {
    path: 'docs/architecture.md',
    text: '# Architecture\n\napps/web assembles the product.\npackages/ui supplies shared shadcn components.\npackages/client and packages/host-plugins own product features.\npackages/protocol defines HTTP contracts.\npackages/runtime owns plugin lifecycles.\napps/host hosts the server plugin graph.',
  },
  {
    path: 'docs/notes.md',
    text: '# Notes\n\nKeep feature state out of the shell.\nUse the existing design system before adding another abstraction.',
  },
];

export function createFilesView() {
  const { getSnapshot, subscribe, publish } = createStore<{
    selected: string | null;
    expanded: boolean;
  }>({
    selected: null,
    expanded: true,
  });

  const update = (next: Partial<ReturnType<typeof getSnapshot>>) => {
    publish({ ...getSnapshot(), ...next });
  };

  return function FilesPanel() {
    const { selected, expanded } = useSyncExternalStore(subscribe, getSnapshot);
    const previewRef = useRef<HTMLPreElement>(null);
    const fileButtonsRef = useRef(new Map<string, HTMLButtonElement>());
    const returnToFileRef = useRef<string | null>(null);
    useEffect(() => {
      if (selected) {
        previewRef.current?.focus({ preventScroll: true });
      } else if (returnToFileRef.current) {
        fileButtonsRef.current.get(returnToFileRef.current)?.focus({ preventScroll: true });
        returnToFileRef.current = null;
      }
    }, [selected]);

    const setSelected = (value: string | null) => update({ selected: value });

    function registerFileButton(path: string, button: HTMLButtonElement | null) {
      if (button) {
        fileButtonsRef.current.set(path, button);
      } else {
        fileButtonsRef.current.delete(path);
      }
    }

    const file = sampleFiles.find((item) => item.path === selected);

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PaneHeader className="border-b">
          {file && (
            <ShellButton
              label="Back to files"
              onClick={() => {
                returnToFileRef.current = selected;
                setSelected(null);
              }}
            >
              <ArrowLeft />
            </ShellButton>
          )}
          <span className="min-w-0 flex-1 text-sm break-all">{file?.path ?? 'Beluga'}</span>
        </PaneHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {file ? (
            <pre
              ref={previewRef}
              tabIndex={0}
              aria-label={`Preview of ${file.path}`}
              className="p-2 font-mono text-sm leading-6 break-words whitespace-pre-wrap"
            >
              {file.text}
            </pre>
          ) : (
            <nav aria-label="Files" className="flex flex-col">
              <Button
                ref={(node) => registerFileButton('README.md', node)}
                variant="ghost"
                className="touch-target justify-start"
                onClick={() => setSelected('README.md')}
              >
                <FileText />
                README.md
              </Button>
              <Collapsible open={expanded} onOpenChange={(open) => update({ expanded: open })}>
                <CollapsibleTrigger render={<DisclosureButton />}>
                  <Folder />
                  <span className="flex-1 text-left">docs</span>
                  <ChevronDown className={expanded ? '' : '-rotate-90'} />
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col">
                  {sampleFiles
                    .filter((item) => item.path.startsWith('docs/'))
                    .map((item) => (
                      <Button
                        key={item.path}
                        ref={(node) => registerFileButton(item.path, node)}
                        variant="ghost"
                        className="touch-target justify-start pl-8"
                        onClick={() => setSelected(item.path)}
                      >
                        <FileText />
                        <span className="truncate">{item.path.slice(5)}</span>
                      </Button>
                    ))}
                </CollapsibleContent>
              </Collapsible>
            </nav>
          )}
        </div>
      </div>
    );
  };
}
