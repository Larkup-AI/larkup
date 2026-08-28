/**
 * Parse a JSON object returned by a model while tolerating markdown fences or
 * a short explanatory prefix. The returned object still has to be valid JSON.
 */
export function parseStructuredJsonObject(text: string): unknown {
  const normalized = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const candidates = [normalized];
  const embedded = extractFirstJsonObject(normalized);
  if (embedded && embedded !== normalized) candidates.push(embedded);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next normalized candidate before surfacing a safe error.
    }
  }
  throw new Error('Media model returned malformed structured output. The affected media frame was skipped.');
}

function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}
