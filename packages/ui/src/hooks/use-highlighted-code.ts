import type { loadHighlighter } from '@workspace/ui/lib/highlighter';
import * as React from 'react';

export function useHighlightedCode(value: string, language: string) {
  // A trailing newline would render as an extra empty line.
  const code = value.endsWith('\n') ? value.slice(0, -1) : value;
  const [loaded, setLoaded] = React.useState<{
    language: string;
    highlighter: Awaited<ReturnType<typeof loadHighlighter>>;
  } | null>(null);
  const highlighter = loaded?.language === language ? loaded.highlighter : null;

  React.useEffect(() => {
    let cancelled = false;

    import('@workspace/ui/lib/highlighter')
      .then(({ loadHighlighter }) => loadHighlighter(language))
      .then((next) => {
        if (!cancelled) {
          setLoaded({ language, highlighter: next });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [language]);

  // The complete lines, highlighted. While the code streams, only the new
  // lines are tokenized, starting from the grammar state of the last one.
  const [completed, setCompleted] = React.useState<{
    highlighter: typeof highlighter;
    source: string;
    lines: React.ReactNode[];
    grammarState?: Parameters<NonNullable<typeof highlighter>['highlight']>[1];
  }>({ highlighter: null, source: '', lines: [] });

  let nextCompleted = completed;
  if (nextCompleted.highlighter !== highlighter || !code.startsWith(nextCompleted.source)) {
    nextCompleted = { highlighter, source: '', lines: [] };
  }

  const completeLineEnd = code.lastIndexOf('\n') + 1;
  if (highlighter && completeLineEnd > nextCompleted.source.length) {
    const newLines = code.slice(nextCompleted.source.length, completeLineEnd - 1);
    const result = highlighter.highlight(newLines, nextCompleted.grammarState);
    nextCompleted = {
      highlighter,
      source: code.slice(0, completeLineEnd),
      lines: [...nextCompleted.lines, ...result.lines],
      grammarState: result.state,
    };
  }

  if (nextCompleted !== completed) {
    setCompleted(nextCompleted);
  }

  const unfinishedLine = code.slice(completeLineEnd);

  return React.useMemo(() => {
    if (!highlighter) {
      return code.split('\n');
    }

    // Tokenize the unfinished line without advancing the cached grammar state.
    const tail = highlighter.highlight(unfinishedLine, nextCompleted.grammarState).lines[0];
    return [...nextCompleted.lines, tail];
  }, [code, highlighter, nextCompleted, unfinishedLine]);
}
