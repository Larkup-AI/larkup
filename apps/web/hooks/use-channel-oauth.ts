import { useEffect, useRef } from 'react';

export type ChannelOAuthResult =
  | { channelId: string; status: 'connected'; fields: Record<string, string>; team?: string }
  | { channelId: string; status: 'error'; error: string };

interface Options {
  onConnected?: (result: Extract<ChannelOAuthResult, { status: 'connected' }>) => void;
  onError?: (error: string) => void;
}

/**
 * Opens a channel's one-click OAuth install
 */
export function useChannelOAuth({ onConnected, onError }: Options = {}) {
  const handlers = useRef({ onConnected, onError });
  useEffect(() => {
    handlers.current = { onConnected, onError };
  });

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.data?.type !== 'channel_oauth') return;
      const result = event.data as ChannelOAuthResult;
      result.status === 'connected'
        ? handlers.current.onConnected?.(result)
        : handlers.current.onError?.(result.error);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function connect(startUrl: string) {
    window.open(
      startUrl,
      'channel-oauth',
      'width=600,height=800,toolbar=0,scrollbars=1,status=1,resizable=1',
    );
  }

  return { connect };
}
