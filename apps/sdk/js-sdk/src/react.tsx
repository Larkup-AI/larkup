import React, { useState, useEffect } from 'react';

export interface AgentWidgetProps {
  /** The URL of the deployed Agent Server  */
  serverUrl: string;
  /** Custom trigger element to open the chat. If not provided, a default button is shown. */
  trigger?: React.ReactNode;
  /** Override the width of the chat window */
  width?: number | string;
  /** Override the height of the chat window */
  height?: number | string;
  /** Initial state of the widget (open/closed) */
  defaultOpen?: boolean;
  /** Position on screen if using default trigger */
  position?: 'bottom-right' | 'bottom-left';
}

export function AgentWidget({
  serverUrl,
  trigger,
  width = 380,
  height = 600,
  defaultOpen = false,
  position = 'bottom-right',
}: AgentWidgetProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Normalize serverUrl to avoid double slashes
  const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
  const chatUiUrl = `${baseUrl}/chat-ui`;

  const posStyles: React.CSSProperties = {
    position: 'fixed',
    bottom: '24px',
    [position === 'bottom-right' ? 'right' : 'left']: '24px',
    zIndex: 9999,
  };

  const windowStyles: React.CSSProperties = {
    position: 'fixed',
    bottom: '90px',
    [position === 'bottom-right' ? 'right' : 'left']: '24px',
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.16)',
    borderRadius: '16px',
    overflow: 'hidden',
    zIndex: 9999,
    display: isOpen ? 'block' : 'none',
    border: '1px solid rgba(0,0,0,0.1)',
    transition: 'opacity 0.2s ease-in-out, transform 0.2s ease-in-out',
    opacity: isOpen ? 1 : 0,
    transform: isOpen ? 'translateY(0)' : 'translateY(10px)',
  };

  const defaultTriggerStyles: React.CSSProperties = {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    backgroundColor: '#000',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    border: 'none',
    fontSize: '24px',
    transition: 'transform 0.2s ease',
  };

  return (
    <>
      <div style={windowStyles}>
        <iframe
          src={chatUiUrl}
          style={{ width: '100%', height: '100%', border: 'none' }}
          title="Larkup Agent Chat"
        />
      </div>

      <div style={posStyles} onClick={() => setIsOpen(!isOpen)}>
        {trigger ? (
          trigger
        ) : (
          <button style={defaultTriggerStyles} aria-label="Toggle chat">
            {isOpen ? '✕' : '💬'}
          </button>
        )}
      </div>
    </>
  );
}
