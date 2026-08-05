import { useEffect } from 'react';

interface Options {
  onSuccess?: (integration: string) => void;
  onError?: (error: string, integration: string) => void;
}

/** Opens the shared OAuth proxy for a registry integration. */
export function useIntegrationAuth({ onSuccess, onError }: Options = {}) {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.data?.type !== 'integration_oauth' ||
        typeof event.data.integration !== 'string'
      )
        return;
      event.data.status === 'connected'
        ? onSuccess?.(event.data.integration)
        : onError?.('Failed to connect integration', event.data.integration);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onError, onSuccess]);

  function connect(integration: string) {
    const proxyUrl =
      process.env.NEXT_PUBLIC_INTEGRATIONS_PROXY_URL || 'https://larkup-proxy.vercel.app/api/oauth';
    const callback = `${window.location.origin}/api/integrations/${integration}/callback`;
    window.open(
      `${proxyUrl}/${integration}?redirect_to=${encodeURIComponent(callback)}`,
      `${integration}-connection`,
      'width=600,height=800,toolbar=0,scrollbars=1,status=1,resizable=1',
    );
  }
  return { connect };
}
