import { useEffect } from 'react';

interface UseNotionAuthOptions {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export function useNotionAuth({ onSuccess, onError }: UseNotionAuthOptions = {}) {
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === 'notion_oauth') {
        if (event.data.status === 'connected') {
          onSuccess?.();
        } else if (event.data.status === 'error') {
          onError?.(event.data.error || 'Failed to connect to Notion');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSuccess, onError]);

  const connectToNotion = (onClosePopup?: () => void) => {
    const customAuthUrl =
      process.env.NEXT_PUBLIC_NOTION_AUTHORIZATION_URL ||
      'https://larkup-proxy.vercel.app/api/oauth/notion';

    const redirectUri = `${window.location.origin}/api/integrations/notion/callback`;
    const authUrl = `${customAuthUrl}?redirect_to=${encodeURIComponent(redirectUri)}`;

    const width = 600;
    const height = 800;
    const left = window.innerWidth / 2 - window.innerWidth / 2 + window.screenX; // Wait, window.innerWidth / 2 - width / 2
    const top = window.innerHeight / 2 - window.innerHeight / 2 + window.screenY;

    // fixing the left and top calculations:
    const calculatedLeft = window.innerWidth / 2 - width / 2 + window.screenX;
    const calculatedTop = window.innerHeight / 2 - height / 2 + window.screenY;

    const popup = window.open(
      authUrl,
      'Notion Connection',
      `width=${width},height=${height},left=${calculatedLeft},top=${calculatedTop},toolbar=0,scrollbars=1,status=1,resizable=1`,
    );

    if (popup) {
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          onClosePopup?.();
        }
      }, 500);
    }
  };

  return { connectToNotion };
}
