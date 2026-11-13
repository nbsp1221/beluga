import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from '@workspace/ui/components/code-block';
import { useHighlightedCode } from '@workspace/ui/hooks/use-highlighted-code';
import { Streamdown, type Components, defaultComponents } from 'streamdown';

function FencedCode({ value, language }: { value: string; language: string }) {
  const lines = useHighlightedCode(value, language);
  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>{language || 'Code'}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={value} className="touch-target" />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent lineNumbers>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

const components: Components = {
  inlineCode: defaultComponents.code,
  code: ({ className, children }) => (
    <FencedCode
      value={typeof children === 'string' ? children : ''}
      language={className?.match(/\blanguage-(\S+)/)?.[1] ?? ''}
    />
  ),
};

const mediaElements = ['img', 'picture', 'audio', 'video', 'source'];

export function MessageMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <Streamdown
      className="min-w-0 text-sm leading-6"
      mode={streaming ? 'streaming' : 'static'}
      isAnimating={streaming}
      components={components}
      controls={false}
      skipHtml
      disallowedElements={mediaElements}
    >
      {text}
    </Streamdown>
  );
}
