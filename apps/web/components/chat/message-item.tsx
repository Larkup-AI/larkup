"use client";

import type { Message } from "ai";
import { KnowledgeBaseResult } from "@/components/chat/knowledge-base-result";

export function MessageItem({
  message,
  isLast,
  isStreaming,
}: {
  message: Message;
  isLast?: boolean;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/10 px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  // Collect tool invocation parts for knowledge base results
  const toolParts = (message.parts ?? []).filter(
    (p: any) =>
      p.type === "tool-invocation" &&
      p.toolInvocation?.toolName === "searchKnowledgeBase",
  );

  const textParts = (message.parts ?? []).filter(
    (p: any) => p.type === "text",
  );

  // Determine if we're still waiting for text (shimmering state)
  const isShimmering =
    textParts.every((p: any) => !p.text || p.text.trim().length === 0) &&
    isLast &&
    isStreaming;

  return (
    <div className="flex flex-col gap-3">
      {toolParts.length > 0 ? (
        <KnowledgeBaseResult parts={toolParts} isShimmering={isShimmering} />
      ) : null}

      {/* Text content — render as simple formatted text */}
      {textParts.map((part: any, i: number) =>
        part.text ? (
          <div
            key={i}
            className="prose prose-sm max-w-none text-[15px] text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-foreground prose-a:underline prose-a:underline-offset-2 prose-code:rounded prose-code:bg-secondary prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none"
            dangerouslySetInnerHTML={{ __html: simpleMarkdown(part.text) }}
          />
        ) : null,
      )}

      {/* Fallback: if no parts, use message.content directly */}
      {textParts.length === 0 && message.content ? (
        <div
          className="prose prose-sm max-w-none text-[15px] text-foreground prose-headings:text-foreground prose-strong:text-foreground"
          dangerouslySetInnerHTML={{
            __html: simpleMarkdown(message.content),
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Minimal markdown → HTML conversion for chat messages.
 * Handles bold, italic, inline code, links, and line breaks.
 * No external dependency needed for this lightweight use case.
 */
function simpleMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Code blocks (```)
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      '<pre class="rounded-lg bg-secondary p-3 text-xs overflow-x-auto"><code>$2</code></pre>',
    )
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Links
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    )
    // Headings
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-4 mb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-semibold mt-4 mb-2">$1</h1>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Numbered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // Line breaks
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>");
}
