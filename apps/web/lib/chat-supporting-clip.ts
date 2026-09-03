/**
 * Returns true only for the first assistant response in a chat transcript,
 * so its first supporting clip (if a video search produced one) auto-opens
 * instead of staying collapsed behind a "Watch supporting clip" click. This
 * has no memory across reloads (no sessionStorage) — the first message's
 * clip auto-opens the same way every time the chat is loaded.
 */
export function shouldAutoOpenSupportingClip(
  messages: readonly { role: string }[],
  messageIndex: number,
): boolean {
  return (
    messages[messageIndex]?.role === 'assistant' &&
    messageIndex === messages.findIndex((message) => message.role === 'assistant')
  );
}
