type IncomingMessage = Record<string, unknown> & {
  id?: unknown;
  role?: unknown;
  parts?: unknown;
  content?: unknown;
};

/** Accept UI messages and the common curl-friendly `{ role, content }` shape. */
export function normalizeIncomingMessages(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const message = candidate as IncomingMessage;
    if (!['user', 'assistant', 'system'].includes(String(message.role ?? ''))) return [];

    const suppliedParts = Array.isArray(message.parts)
      ? message.parts.filter(
          (part): part is Record<string, unknown> =>
            Boolean(part) && typeof part === 'object' && typeof (part as any).type === 'string',
        )
      : [];
    const contentParts = Array.isArray(message.content)
      ? message.content.filter(
          (part): part is Record<string, unknown> =>
            Boolean(part) && typeof part === 'object' && typeof (part as any).type === 'string',
        )
      : [];
    const parts =
      suppliedParts.length > 0
        ? suppliedParts
        : contentParts.length > 0
          ? contentParts
          : typeof message.content === 'string' && message.content.trim()
            ? [{ type: 'text', text: message.content }]
            : [];
    if (parts.length === 0) return [];

    return [
      {
        ...message,
        id: typeof message.id === 'string' && message.id.trim() ? message.id : `incoming-${index}`,
        role: message.role as 'user' | 'assistant' | 'system',
        parts,
      },
    ];
  });
}
