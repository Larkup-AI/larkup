import katex from 'katex';
import { isSafeImageUrl } from './rich-blocks';

/**
 * Lightweight markdown-to-HTML for assistant chat answers. Emitted classes
 * (`msg-*`, `assistant-text-content`) are styled in the shared
 * `source.css`, so every host renders the same clean, blog-like surface.
 *
 * This module is intentionally free of CSS/runtime side-effects (it does not
 * import the KaTeX stylesheet) so it stays unit-testable in Node. The KaTeX
 * stylesheet is imported once by the component that renders this HTML.
 */

function normalizeRepeatedOrderedListMarkers(text: string): string {
  const lines = text.split('\n');
  let previousRepeatedMarker: number | null = null;
  let nextNumber = 2;

  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].match(/^(\s*)1\.\s+(.+)$/);
    if (!marker) {
      if (/^\s*\d+\.\s+/.test(lines[index])) {
        previousRepeatedMarker = null;
        nextNumber = 2;
      }
      continue;
    }

    const onlySupportingListContentSincePrevious =
      previousRepeatedMarker !== null &&
      lines
        .slice(previousRepeatedMarker + 1, index)
        .every((line) => !line.trim() || /^\s*[-*+]\s+/.test(line));

    if (onlySupportingListContentSincePrevious) {
      lines[index] = `${marker[1]}${nextNumber}. ${marker[2]}`;
      nextNumber += 1;
    } else {
      nextNumber = 2;
    }

    previousRepeatedMarker = index;
  }

  return lines.join('\n');
}

export function renderMarkdown(text: string, safeImageUrls?: Set<string>): string {
  if (!text) return '';

  let html = normalizeRepeatedOrderedListMarkers(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Math blocks \[ ... \] and $$ ... $$
  html = html.replace(/\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$/g, (match, p1, p2) => {
    const math = p1 || p2;
    try {
      return katex.renderToString(math, { displayMode: true, throwOnError: false });
    } catch {
      return match;
    }
  });

  // Inline math \( ... \) and $ ... $
  html = html.replace(/\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g, (match, p1, p2) => {
    const math = p1 || p2;
    try {
      return katex.renderToString(math, { displayMode: false, throwOnError: false });
    } catch {
      return match;
    }
  });

  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
    const cleanUrl = url.trim();
    const isWhitelisted =
      (safeImageUrls && safeImageUrls.has(cleanUrl)) ||
      cleanUrl.startsWith('/api/') ||
      cleanUrl.startsWith('/icons/') ||
      cleanUrl.startsWith('data:image/');
    if (isWhitelisted || isSafeImageUrl(cleanUrl)) {
      return `<figure class="my-3 overflow-hidden rounded-xl border border-border/70 bg-card p-1 shadow-xs"><img src="${cleanUrl}" alt="${alt}" class="w-full max-h-96 object-contain rounded-lg bg-muted/10" loading="lazy" /><figcaption class="px-3 py-2 text-center text-xs text-muted-foreground font-medium border-t border-border/40">${alt || 'Indexed figure'}</figcaption></figure>`;
    }
    return `<span class="text-muted-foreground italic text-xs">[Image reference${
      alt ? `: ${alt}` : ''
    }]</span>`;
  });

  // Code blocks — styled premium
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    '<pre class="msg-code-block"><code>$2</code></pre>',
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="msg-inline-code">$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="msg-bold">$1</strong>');

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links and Media (Video/Audio)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.match(/\.(mp4|webm|ogg)$/) || lowerUrl.includes('video')) {
      return `<video src="${url}" controls preload="metadata" class="max-w-90 w-full rounded-lg my-2 border border-border bg-card"></video>`;
    }
    if (lowerUrl.match(/\.(mp3|wav|m4a|oga)$/) || lowerUrl.includes('audio')) {
      return `<audio src="${url}" controls preload="metadata" class="max-w-80 w-full my-2"></audio>`;
    }
    return `<a href="${url}" target="_blank" rel="noreferrer" class="msg-link">${label}</a>`;
  });

  // Horizontal rules (a line of only ---, ___, or ***)
  html = html.replace(/^(?:-{3,}|_{3,}|\*{3,})\s*$/gm, '<hr class="msg-hr"/>');

  html = html.replace(/^#### (.+)$/gm, '<h4 class="msg-h4">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="msg-h3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="msg-h2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="msg-h1">$1</h1>');

  // Blockquotes — consecutive lines beginning with "> " (escaped to "&gt; ")
  html = html.replace(/^&gt;\s?(.*)$/gm, '<p class="msg-quote-line">$1</p>');
  html = html.replace(
    /(<p class="msg-quote-line">[\s\S]*?<\/p>\n?)+/g,
    (match) =>
      `<blockquote class="msg-quote">${match.replace(/msg-quote-line/g, 'msg-p')}</blockquote>`,
  );

  // Unordered lists — collect consecutive lines into <ul>. Accept all three
  // standard bullet markers (-, *, +); models frequently emit "* item", which
  // otherwise leaks through as a literal asterisk. A lone leading marker is
  // safe from the inline-italic pass above, which needs a closing "*" on the
  // same line.
  html = html.replace(/^[-*+] (.+)$/gm, '<li class="msg-li">$1</li>');
  // Wrap consecutive <li> in <ul> (including when separated by blank lines)
  html = html.replace(
    /(<li class="msg-li">.*?<\/li>\n?)+/g,
    (match) => `<ul class="msg-ul">${match}</ul>`,
  );

  html = html.replace(/(^\d+\. .+$)(\n\n)((?=\d+\. ))/gm, '$1\n$3');

  html = html.replace(/^(\d+)\. (.+)$/gm, '<li class="msg-li-ordered" data-order="$1">$2</li>');
  html = html.replace(/(<li class="msg-li-ordered" data-order="\d+">.*?<\/li>\n?)+/g, (match) => {
    const start = match.match(/data-order="(\d+)"/)?.[1] ?? '1';
    return `<ol class="msg-ol" start="${start}">${match.replace(/ data-order="\d+"/g, '')}</ol>`;
  });

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p class="msg-p">');

  html = html.replace(/(<?\/?(?:ul|ol|li|h1|h2|h3|h4|hr|blockquote|pre)[^>]*>)\n+/g, '$1');
  html = html.replace(/\n+(<\/?(?:ul|ol|li|h1|h2|h3|h4|hr|blockquote|pre)[^>]*>)/g, '$1');

  html = html.replace(/\n/g, '<br/>');

  return html;
}
