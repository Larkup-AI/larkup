import { useEffect, useId } from 'react';

export interface AgentWidgetProps {
  /** Generated Agent Server URL. */
  serverUrl: string;
  /** Optional bearer token for protected Agent Servers. */
  apiKey?: string;
  /** Widget corner. */
  position?: 'bottom-right' | 'bottom-left';
  /** Widget color theme. */
  theme?: 'light' | 'dark';
  /** Widget accent color. */
  primaryColor?: string;
  /** Widget title. */
  title?: string;
  /** Initial message shown by the widget. */
  welcomeMessage?: string;
  /** Composer placeholder. */
  placeholder?: string;
  /** Optional logo image URL. */
  logoUrl?: string;
  /** Class added to the generated widget mount. */
  className?: string;
}

/** Loads a generated Agent Server widget into a React application. */
export function AgentWidget({
  serverUrl,
  apiKey,
  position,
  theme,
  primaryColor,
  title,
  welcomeMessage,
  placeholder,
  logoUrl,
  className,
}: AgentWidgetProps) {
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const mountClass = `larkup-widget-${instanceId}`;

  useEffect(() => {
    const script = document.createElement('script');
    const baseUrl = serverUrl.replace(/\/+$/, '');

    script.async = true;
    script.src = `${baseUrl}/widget.js`;
    script.dataset.larkupWidget = '';
    script.dataset.host = baseUrl;
    script.dataset.class = [className, mountClass].filter(Boolean).join(' ');
    if (apiKey) script.dataset.apiKey = apiKey;
    if (position) script.dataset.position = position;
    if (theme) script.dataset.theme = theme;
    if (primaryColor) script.dataset.primaryColor = primaryColor;
    if (title) script.dataset.title = title;
    if (welcomeMessage) script.dataset.welcomeMessage = welcomeMessage;
    if (placeholder) script.dataset.placeholder = placeholder;
    if (logoUrl) script.dataset.logoUrl = logoUrl;
    document.body.appendChild(script);

    return () => {
      script.remove();
      for (const mount of Array.from(document.getElementsByClassName(mountClass))) {
        mount.remove();
      }
    };
  }, [
    apiKey,
    className,
    logoUrl,
    mountClass,
    placeholder,
    position,
    primaryColor,
    serverUrl,
    theme,
    title,
    welcomeMessage,
  ]);

  return null;
}
