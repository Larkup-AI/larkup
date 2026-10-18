export function reactWidgetSnippet({ baseUrl, apiKey = 'YOUR_SERVER_API_KEY', widget = {} }) {
  const settings = {
    apiKey,
    position: widget.position || 'bottom-right',
    theme: widget.darkMode ? 'dark' : 'light',
    primaryColor: widget.primaryColor || '#111827',
    ...(widget.logoUrl ? { logoUrl: widget.logoUrl } : {}),
    ...(widget.customCss ? { customCss: widget.customCss } : {}),
  };
  return `'use client';

import { useEffect } from 'react';

export function LarkupWidget() {
  useEffect(() => {
    const script = document.createElement('script');
    script.async = true;
    script.src = ${JSON.stringify(baseUrl.replace(/\/+$/, '') + '/widget.js')};
    Object.assign(script.dataset, ${JSON.stringify(settings, null, 2)});
    let disposed = false;
    script.onload = () => { if (disposed) window.LarkupWidget?.destroy(); };
    document.body.appendChild(script);
    return () => {
      disposed = true;
      script.remove();
      window.LarkupWidget?.destroy();
    };
  }, []);

  return null;
}`;
}

export function agentSdkSnippet(baseUrl) {
  return `import { LarkupAgentClient } from '@larkup/sdk';

const agent = new LarkupAgentClient({
  baseUrl: ${JSON.stringify(baseUrl.replace(/\/+$/, ''))},
  apiKey: process.env.LARKUP_API_KEY,
});

const answer = await agent.chatText('Hello');`;
}
