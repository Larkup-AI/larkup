/** Decode the transport wrappers AI providers may use for structured tool output. */
export function decodeToolOutput(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return decodeToolOutput(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === 'object' && (value as { type?: string }).type === 'json') {
    return decodeToolOutput((value as { value?: unknown }).value);
  }
  return value && typeof value === 'object' ? value : undefined;
}
