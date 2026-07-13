"use client";

import type { UIMessage } from "ai";
import { KnowledgeBaseResult } from "@/components/chat/knowledge-base-result";

export function MessageItem({
  message,
  isLast,
  isStreaming,
}: {
  message: UIMessage;
  isLast?: boolean;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p: any) => p.text)
      .join("");
    return (
      <div className="message user-message flex justify-end" data-role="user">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/10 px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
          {text}
        </div>
      </div>
    );
  }

  // UIMessage parts: "text", "tool-searchKnowledgeBase", etc.
  const kbParts = message.parts.filter(
    (p: any) => p.type === "tool-searchKnowledgeBase",
  );
  const textParts = message.parts.filter((p: any) => p.type === "text");

  const isShimmering =
    textParts.every((p: any) => !p.text || p.text.trim().length === 0) &&
    isLast &&
    isStreaming;

  return (
    <div className="message assistant-message flex flex-col gap-3" data-role="assistant">
      {kbParts.length > 0 ? (
        <KnowledgeBaseResult parts={kbParts} isShimmering={isShimmering} />
      ) : null}

      {textParts.map((part: any, i: number) => (
        <div
          key={i}
          className="prose prose-sm max-w-none text-[15px] text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-foreground prose-a:underline prose-a:underline-offset-2 prose-code:rounded prose-code:bg-secondary prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text || "") }}
        />
      ))}
    </div>
  );
}

/**
 * Lightweight markdown → HTML for chat messages.
 */
function renderMarkdown(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Code blocks
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      '<pre class="rounded-lg bg-secondary p-3 text-xs overflow-x-auto my-2"><code>$2</code></pre>',
    )
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
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
    .replace(
      /^### (.+)$/gm,
      '<h3 class="text-base font-semibold mt-3 mb-1">$1</h3>',
    )
    .replace(
      /^## (.+)$/gm,
      '<h2 class="text-lg font-semibold mt-4 mb-1">$1</h2>',
    )
    .replace(
      /^# (.+)$/gm,
      '<h1 class="text-xl font-semibold mt-4 mb-2">$1</h1>',
    )
    // Lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // Paragraphs
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>");
}
