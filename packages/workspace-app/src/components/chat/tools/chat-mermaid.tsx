'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, GitBranch, RefreshCw } from 'lucide-react';
import { Button } from '@larkup/workspace-ui/button';

export function ChatMermaid({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const rawId = useId();
  const diagramId = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'neutral',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        });

        const cleanCode = code.trim();
        if (!cleanCode) return;

        const { svg: renderedSvg } = await mermaid.render(diagramId, cleanCode);
        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to render diagram');
        }
      }
    }

    render();

    return () => {
      cancelled = true;
    };
  }, [code, diagramId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      data-testid="chat-mermaid-diagram"
      className="my-3.5 w-full overflow-hidden rounded-2xl border border-border/75 bg-card/90 shadow-xs"
    >
      <div className="flex items-center justify-between border-b border-border/40 px-3.5 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <GitBranch className="size-3.5 text-foreground" />
          <span>Diagram</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-600" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3" />
              <span>Copy</span>
            </>
          )}
        </Button>
      </div>

      <div className="flex min-h-24 items-center justify-center overflow-x-auto p-4 sm:p-6">
        {error ? (
          <div className="w-full rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
            <p className="font-medium">Diagram Syntax Preview</p>
            <pre className="mt-2 max-h-40 overflow-auto font-mono text-[11px] whitespace-pre-wrap">
              {code}
            </pre>
          </div>
        ) : svg ? (
          <div
            ref={containerRef}
            className="w-full flex justify-center [&_svg]:max-w-full [&_svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="size-3.5 animate-spin" />
            <span>Rendering diagram…</span>
          </div>
        )}
      </div>
    </div>
  );
}
