import { useCallback, useRef, useState } from 'react';
import type { ChatMessage, WidgetConfig } from '../types';
import { streamChat } from './agent-client';

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

export interface UseAgentChat {
  messages: ChatMessage[];
  /** True from submit until the stream ends. */
  busy: boolean;
  send: (text: string) => void;
  /** Cancel the in-flight turn, keeping whatever text already streamed. */
  stop: () => void;
  /** Clear the transcript and cancel anything in flight. */
  reset: () => void;
}

/**
 * Conversation state for one widget instance.
 *
 * The transcript is held in a ref with React state as a mirror, rather than in
 * state alone. `send()` has to read the full history *synchronously* to build
 * the request body, and a `setState` updater does not run until the next
 * render — reading history from inside one would send an empty conversation on
 * every turn. The ref is the source of truth; `commit()` keeps both in step.
 *
 * There is deliberately no localStorage/sessionStorage persistence: the widget
 * runs on third-party pages where conversation content may be personal, and
 * durable sessions belong to the server-side session model, not to browser
 * storage we cannot govern.
 */
export function useAgentChat(config: WidgetConfig): UseAgentChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const transcript = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const commit = useCallback((next: ChatMessage[]) => {
    transcript.current = next;
    setMessages(next);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    commit(transcript.current.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
  }, [commit]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    commit([]);
  }, [commit]);

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || busy) return;

      const userMessage: ChatMessage = {
        id: nextId('u'),
        role: 'user',
        text: content,
        blocks: [],
      };
      const assistantId = nextId('a');
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        blocks: [],
        streaming: true,
      };

      // Failed turns are excluded: replaying "Something went wrong." as an
      // assistant message would poison the next answer.
      const history = [...transcript.current, userMessage]
        .filter((m) => m.text && !m.error)
        .map((m) => ({ role: m.role, content: m.text }));

      commit([...transcript.current, userMessage, assistantMessage]);

      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);

      const patch = (update: Partial<ChatMessage>) =>
        commit(transcript.current.map((m) => (m.id === assistantId ? { ...m, ...update } : m)));

      void streamChat({
        config,
        messages: history,
        signal: controller.signal,
        onUpdate: (state) => patch({ text: state.text, blocks: state.blocks }),
      })
        .then((state) => {
          if (state.errorText) {
            patch({ text: state.errorText, error: true, streaming: false });
          } else if (!state.text && !state.blocks.length) {
            patch({ text: 'The agent returned an empty response.', error: true, streaming: false });
          } else {
            patch({ streaming: false });
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            patch({ streaming: false });
            return;
          }
          patch({
            text: error instanceof Error ? error.message : 'Something went wrong.',
            error: true,
            streaming: false,
          });
        })
        .finally(() => {
          if (abortRef.current === controller) abortRef.current = null;
          setBusy(false);
        });
    },
    [busy, commit, config],
  );

  return { messages, busy, send, stop, reset };
}
