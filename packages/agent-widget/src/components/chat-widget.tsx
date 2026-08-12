import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AgentWidgetStyle, ChatMessage, PublicAgentConfig, WidgetConfig } from '../types';
import { fetchPublicConfig } from '../lib/agent-client';
import { resolveStyle } from '../lib/config';
import { useAgentChat } from '../lib/use-agent-chat';
import { OutputBlock } from './output-block';
import { BotIcon, ChatIcon, CloseIcon, RefreshIcon, SendIcon, StopIcon } from './icons';

const RADIUS_PX: Record<AgentWidgetStyle['borderRadius'], string> = {
  sm: '8px',
  md: '12px',
  lg: '16px',
  full: '26px',
};

/** Darken a hex colour for the hover state without pulling in a colour library. */
function shade(hex: string, amount: number): string {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  let value = match[1];
  if (value.length === 3) value = value.replace(/./g, (c) => c + c);
  const channels = [0, 2, 4].map((i) => {
    const channel = parseInt(value.slice(i, i + 2), 16);
    return Math.max(0, Math.min(255, Math.round(channel * (1 - amount))));
  });
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Pick readable foreground text for the configured primary colour.
 *
 * A customer will happily set a pale yellow brand colour; white-on-yellow is
 * unreadable, so contrast is computed rather than assumed.
 */
function readableOn(hex: string): string {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim());
  if (!match) return '#ffffff';
  let value = match[1];
  if (value.length === 3) value = value.replace(/./g, (c) => c + c);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminance > 0.55 ? '#16181d' : '#ffffff';
}

function Message({ message }: { message: ChatMessage }) {
  const showCaret = message.streaming && message.text.length > 0;
  const showTyping = message.streaming && message.text.length === 0 && message.blocks.length === 0;

  return (
    <div className={`lk-msg lk-msg--${message.role}`}>
      {showTyping ? (
        <div className="lk-bubble lk-typing" aria-label="Agent is typing">
          <span />
          <span />
          <span />
        </div>
      ) : (
        message.text && (
          <div className={`lk-bubble${message.error ? ' lk-bubble--error' : ''}`}>
            {message.text}
            {showCaret && <i className="lk-caret" />}
          </div>
        )
      )}

      {message.blocks.length > 0 && (
        <div className="lk-blocks">
          {message.blocks.map((block) => (
            <OutputBlock key={block.key} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}

function Composer({
  placeholder,
  busy,
  disabled,
  onSend,
  onStop,
}: {
  placeholder: string;
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the content up to the CSS max-height, then scroll.
  const autoSize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const submit = () => {
    if (!value.trim() || busy || disabled) return;
    onSend(value);
    setValue('');
    requestAnimationFrame(autoSize);
  };

  return (
    <div className="lk-composer">
      <textarea
        ref={inputRef}
        className="lk-input"
        rows={1}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={placeholder}
        onChange={(event) => {
          setValue(event.target.value);
          autoSize();
        }}
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter is a newline — the convention every chat
          // UI the visitor has already used follows.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {busy ? (
        <button type="button" className="lk-send" onClick={onStop} aria-label="Stop generating">
          <StopIcon />
        </button>
      ) : (
        <button
          type="button"
          className="lk-send"
          onClick={submit}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
        >
          <SendIcon />
        </button>
      )}
    </div>
  );
}

export function ChatWidget({ config }: { config: WidgetConfig }) {
  const [open, setOpen] = useState(Boolean(config.defaultOpen));
  const [serverConfig, setServerConfig] = useState<PublicAgentConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { messages, busy, send, stop, reset } = useAgentChat(config);
  const listRef = useRef<HTMLDivElement>(null);

  // Load the redacted public config once. A failure is surfaced inside the
  // panel instead of hiding the widget, so an embedder debugging their install
  // can see exactly what went wrong.
  useEffect(() => {
    const controller = new AbortController();
    fetchPublicConfig(config, controller.signal)
      .then((value) => {
        setServerConfig(value);
        setLoadError(null);
        config.onReady?.();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'Could not reach the agent.';
        setLoadError(message);
        config.onError?.(error instanceof Error ? error : new Error(message));
      });
    return () => controller.abort();
  }, [config]);

  const style = resolveStyle(serverConfig, config.style);

  // Pin to the newest message as it streams.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Listening on the document means Escape works even while the host page
    // holds focus; the shadow root does not receive key events on its own.
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const primary = style.primaryColor;
  const rootStyle = {
    '--lk-primary': primary,
    '--lk-primary-hover': shade(primary, 0.12),
    '--lk-on-primary': readableOn(primary),
    '--lk-radius': RADIUS_PX[style.borderRadius] ?? RADIUS_PX.lg,
  } as CSSProperties;

  const needsPublish = serverConfig?.status === 'needs_publish';
  const blocked = Boolean(loadError);

  return (
    <div
      className={`lk-root lk-root--${style.position === 'bottom-left' ? 'left' : 'right'}${
        style.darkMode ? ' lk-dark' : ''
      }`}
      style={rootStyle}
    >
      {open && (
        <div className="lk-panel" role="dialog" aria-modal="false" aria-label={style.title}>
          <div className="lk-header">
            {style.avatarUrl ? (
              <img className="lk-avatar" src={style.avatarUrl} alt="" />
            ) : (
              <div className="lk-avatar">
                <BotIcon />
              </div>
            )}
            <div className="lk-header-text">
              <p className="lk-title">{style.title}</p>
              <div className="lk-status">
                <span
                  className={`lk-status-dot${
                    blocked || needsPublish ? ' lk-status-dot--warn' : ''
                  }`}
                />
                {blocked ? 'Unavailable' : needsPublish ? 'Not published' : 'Online'}
              </div>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                className="lk-icon-btn"
                onClick={reset}
                aria-label="Start a new conversation"
                title="New conversation"
              >
                <RefreshIcon />
              </button>
            )}
            <button
              type="button"
              className="lk-icon-btn"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              <CloseIcon />
            </button>
          </div>

          {blocked && <div className="lk-notice">{loadError}</div>}
          {!blocked && needsPublish && (
            <div className="lk-notice">
              This agent has no published release yet, so it cannot answer questions.
            </div>
          )}

          <div className="lk-messages" ref={listRef} role="log" aria-live="polite">
            {messages.length === 0 && !blocked && (
              <div className="lk-empty">
                <strong>{serverConfig?.name ?? style.title}</strong>
                {style.welcomeMessage}
              </div>
            )}
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
          </div>

          <Composer
            placeholder={style.placeholder}
            busy={busy}
            disabled={blocked}
            onSend={send}
            onStop={stop}
          />
          <div className="lk-footer">
            Powered by{' '}
            <a href="https://larkup.ai" target="_blank" rel="noopener noreferrer">
              Larkup
            </a>
          </div>
        </div>
      )}

      <button
        type="button"
        className={`lk-launcher${open ? ' lk-launcher--open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Close chat' : 'Open chat'}
        aria-expanded={open}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
      </button>
    </div>
  );
}
