/** Returns true only for the first assistant response in a chat transcript. */
export function shouldAutoOpenSupportingClip(
  messages: readonly { role: string }[],
  messageIndex: number,
): boolean {
  return (
    messages[messageIndex]?.role === 'assistant' &&
    messageIndex === messages.findIndex((message) => message.role === 'assistant')
  );
}
