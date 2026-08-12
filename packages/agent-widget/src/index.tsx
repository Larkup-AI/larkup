/**
 * `@larkup/agent-widget` — the browser entry point.
 *
 * Built as a single self-contained IIFE and served by the Larkup host at
 * `/api/widget.js`. The whole public surface is `window.LarkupAgent`:
 *
 * ```html
 * <script async src="https://acme.com/api/widget.js" data-agent="support-bot"></script>
 * ```
 * ```js
 * const widget = LarkupAgent.init({ agentId: 'support-bot', host: 'https://acme.com' });
 * widget.destroy();
 * ```
 *
 * Isolation: the React root is mounted inside a **Shadow DOM**, so the host
 * page's CSS cannot reach the widget and the widget's CSS cannot leak out. The
 * mount element itself carries only positioning, set as inline `!important`
 * declarations, because that element lives in the host page's light DOM where
 * a stray `div { position: static }` would otherwise apply.
 */

import { createRoot, type Root } from 'react-dom/client';
import widgetCss from './widget.css?inline';
import { ChatWidget } from './components/chat-widget';
import { configFromDataset, resolveConfig } from './lib/config';
import type { WidgetConfig } from './types';

export type { WidgetConfig, PublicAgentConfig, AgentWidgetStyle, WidgetBlock } from './types';

const MOUNT_ATTRIBUTE = 'data-larkup-agent';

/** Handle returned by `init()`. */
export interface WidgetInstance {
  agentId: string;
  destroy: () => void;
}

const instances = new Map<string, WidgetInstance>();

function resolveTarget(target: WidgetConfig['target']): HTMLElement | null {
  if (!target) return null;
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  return element instanceof HTMLElement ? element : null;
}

function createMountElement(agentId: string): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute(MOUNT_ATTRIBUTE, agentId);
  // Inline + !important so host-page CSS cannot un-position or hide the widget.
  // A z-index just under the 32-bit max keeps us above typical overlays while
  // leaving headroom for a host's own critical UI (cookie banners, modals).
  element.style.setProperty('position', 'fixed', 'important');
  element.style.setProperty('left', '0', 'important');
  element.style.setProperty('right', '0', 'important');
  element.style.setProperty('bottom', '0', 'important');
  // Zero height: a viewport-wide anchor that intercepts no clicks. The bubble
  // and panel position themselves against it, so `bottom-left` vs
  // `bottom-right` can still change after the server's style arrives.
  element.style.setProperty('height', '0', 'important');
  element.style.setProperty('z-index', '2147483000', 'important');
  return element;
}

/**
 * Mount a widget.
 *
 * Calling `init()` twice for the same agent destroys the previous instance
 * rather than stacking two bubbles — a common outcome when a snippet ends up in
 * both a layout and a page template.
 */
export function init(options: Partial<WidgetConfig> = {}): WidgetInstance {
  const config = resolveConfig(options);

  instances.get(config.agentId)?.destroy();

  const provided = resolveTarget(config.target);
  const host = provided ?? createMountElement(config.agentId);
  if (!provided) document.body.appendChild(host);

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.replaceChildren();

  const style = document.createElement('style');
  style.textContent = widgetCss;
  shadow.appendChild(style);

  const container = document.createElement('div');
  shadow.appendChild(container);

  let root: Root | null = createRoot(container);
  root.render(<ChatWidget config={config} />);

  const instance: WidgetInstance = {
    agentId: config.agentId,
    destroy() {
      // Unmount asynchronously: React throws if a root is unmounted while it is
      // rendering, which happens when destroy() is called from a component
      // callback such as onError.
      const pending = root;
      root = null;
      if (pending) queueMicrotask(() => pending.unmount());
      if (!provided) host.remove();
      if (instances.get(config.agentId) === instance) instances.delete(config.agentId);
    },
  };

  instances.set(config.agentId, instance);
  return instance;
}

/** Tear down every widget on the page. */
export function destroy(agentId?: string): void {
  if (agentId) {
    instances.get(agentId)?.destroy();
    return;
  }
  for (const instance of [...instances.values()]) instance.destroy();
}

export const version = '0.1.0';

/* ------------------------------------------------------------------ */
/* Auto-initialization from the script tag                             */
/* ------------------------------------------------------------------ */

function autoInit(): void {
  // `document.currentScript` is only defined while the script is executing, so
  // it must be read at module scope — hence the eager call below.
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[data-agent]');
  if (!script) return;

  const dataset = { ...script.dataset } as Record<string, string | undefined>;
  if (!dataset.agent && !dataset.agentId) return; // manual `init()` install

  const config = configFromDataset(dataset, script.src);
  const start = () => {
    try {
      init(config);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
  };

  // `document.body` is null when the snippet sits in <head> without `defer`.
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

if (typeof document !== 'undefined') autoInit();
