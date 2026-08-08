'use client';

import SyntaxHighlighter from 'react-syntax-highlighter';
import { githubGist, atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';

/** Map a generic language hint to a highlight.js language identifier. */
function languageId(language: string): string {
  switch (language) {
    case 'javascript':
      return 'javascript';
    case 'typescript':
      return 'typescript';
    case 'json':
      return 'json';
    case 'markdown':
      return 'markdown';
    case 'yaml':
      return 'yaml';
    case 'python':
      return 'python';
    default:
      return 'plaintext';
  }
}

/**
 * Read-only, syntax-highlighted file viewer using react-syntax-highlighter.
 */
export function CodeViewer({
  value,
  language,
  height = '26rem',
  theme = 'light',
}: {
  value: string;
  language: string;
  height?: string;
  theme?: 'light' | 'dark';
}) {
  return (
    <div style={{ height, overflowY: 'auto' }} className="w-full text-xs font-mono">
      <SyntaxHighlighter
        language={languageId(language)}
        style={theme === 'dark' ? atomOneDark : githubGist}
        customStyle={{
          margin: 0,
          padding: '1rem',
          background: 'transparent',
          fontSize: '12px',
          lineHeight: '1.6',
          fontFamily:
            'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          height: '100%',
        }}
        showLineNumbers
        wrapLongLines
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}
