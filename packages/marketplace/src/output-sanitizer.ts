/** Removes provider-specific hidden reasoning before tool output reaches storage or retrieval. */
export function sanitizeGeneratedOutput(text: string): string {
  let sanitized = text;
  for (const tag of ['think', 'analysis', 'reasoning']) {
    sanitized = sanitized.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
  }
  return sanitized.replace(/<\/?(?:think|analysis|reasoning)\b[^>]*>/gi, '').trim();
}
