type MessageLike = {
  role?: unknown;
  parts?: unknown;
  content?: unknown;
};

/** True once an assistant has visible text and no tool is still awaiting output. */
export function assistantReplyCanClose(message: MessageLike | undefined) {
  if (!message || message.role !== 'assistant') return false;
  const parts = Array.isArray(message.parts)
    ? (message.parts as Array<Record<string, unknown>>)
    : [];
  const hasText =
    parts.some((part) => part.type === 'text' && String(part.text ?? '').trim().length > 0) ||
    (typeof message.content === 'string' && message.content.trim().length > 0);
  if (!hasText) return false;
  return !parts.some((part) => {
    const type = String(part.type ?? '');
    if (!type.startsWith('tool-') && type !== 'dynamic-tool') return false;
    return part.state === 'input-streaming' || part.state === 'input-available';
  });
}
