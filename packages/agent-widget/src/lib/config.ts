/**
 * Config resolution for the embed snippet.
 *
 * An embedder can configure the widget two ways, and both must land on the same
 * shape:
 *
 * ```html
 * <script async src="https://acme.com/api/widget.js" data-agent="support-bot"></script>
 * ```
 * ```js
 * LarkupAgent.init({ agentId: 'support-bot', host: 'https://acme.com' });
 * ```
 */

import type { AgentWidgetStyle, PublicAgentConfig, WidgetConfig } from '../types';

/** Style used before the server's public config arrives, and if it never does. */
export const FALLBACK_STYLE: AgentWidgetStyle = {
  primaryColor: '#6366f1',
  position: 'bottom-right',
  title: 'Chat with us',
  welcomeMessage: 'Hi! How can I help you today?',
  placeholder: 'Type a message…',
  darkMode: false,
  borderRadius: 'lg',
};

/** Strip a trailing slash so `${host}/api/...` never doubles up. */
export function normalizeHost(host: string): string {
  return host.trim().replace(/\/+$/, '');
}

/**
 * Derive the Larkup host from the `src` of the script that loaded us.
 *
 * This is what makes the one-line snippet work: a script served from
 * `https://acme.com/api/widget.js` talks to `https://acme.com`, so the embedder
 * never has to state the host twice.
 */
export function hostFromScriptSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  try {
    return new URL(src, typeof location !== 'undefined' ? location.href : undefined).origin;
  } catch {
    return null;
  }
}

/** Read the `data-*` attributes of the embed snippet. */
export function configFromDataset(
  dataset: Record<string, string | undefined>,
  scriptSrc?: string | null,
): Partial<WidgetConfig> {
  const config: Partial<WidgetConfig> = {};
  const style: Partial<AgentWidgetStyle> = {};

  const agentId = dataset.agent ?? dataset.agentId;
  if (agentId) config.agentId = agentId;

  const host = dataset.host ?? hostFromScriptSrc(scriptSrc);
  if (host) config.host = normalizeHost(host);

  if (dataset.joinCode) config.joinCode = dataset.joinCode;
  if (dataset.open === 'true') config.defaultOpen = true;

  // Style overrides let a customer match the widget to their site without a
  // dashboard round-trip. Anything absent falls back to the agent's own style.
  if (dataset.primaryColor) style.primaryColor = dataset.primaryColor;
  if (dataset.position === 'bottom-left' || dataset.position === 'bottom-right') {
    style.position = dataset.position;
  }
  if (dataset.title) style.title = dataset.title;
  if (dataset.welcomeMessage) style.welcomeMessage = dataset.welcomeMessage;
  if (dataset.placeholder) style.placeholder = dataset.placeholder;
  if (dataset.avatarUrl) style.avatarUrl = dataset.avatarUrl;
  if (dataset.theme === 'dark') style.darkMode = true;
  if (dataset.theme === 'light') style.darkMode = false;
  if (
    dataset.borderRadius === 'sm' ||
    dataset.borderRadius === 'md' ||
    dataset.borderRadius === 'lg' ||
    dataset.borderRadius === 'full'
  ) {
    style.borderRadius = dataset.borderRadius;
  }

  if (Object.keys(style).length > 0) config.style = style;
  return config;
}

/**
 * Merge dashboard-configured style with embedder overrides.
 *
 * Precedence: `init()`/`data-*` override > agent's published `widgetStyle` >
 * `FALLBACK_STYLE`. The dashboard owns the default look so an operator can
 * restyle every embed at once; the embedder can still win locally.
 */
export function resolveStyle(
  serverConfig: PublicAgentConfig | null,
  overrides: Partial<AgentWidgetStyle> | undefined,
): AgentWidgetStyle {
  return {
    ...FALLBACK_STYLE,
    ...(serverConfig?.widgetStyle ?? {}),
    ...(overrides ?? {}),
  };
}

/** Validate and complete a user-supplied config. Throws with actionable text. */
export function resolveConfig(input: Partial<WidgetConfig>): WidgetConfig {
  const agentId = input.agentId?.trim();
  if (!agentId) {
    throw new Error(
      'LarkupAgent: missing agent id. Add data-agent="<agentId>" to the script tag, or pass { agentId } to LarkupAgent.init().',
    );
  }

  const host = input.host ? normalizeHost(input.host) : '';
  if (!host) {
    throw new Error(
      'LarkupAgent: missing host. Add data-host="https://your-larkup-server" to the script tag, or pass { host } to LarkupAgent.init().',
    );
  }

  return { ...input, agentId, host };
}
