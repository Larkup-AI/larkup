import type { SandboxBackend, SandboxProviderAdapter } from '../types.js';
import { e2bAdapter } from './e2b.js';
import { vercelAdapter } from './vercel.js';
import { modalAdapter } from './modal.js';
import { daytonaAdapter } from './daytona.js';
import { browserbaseAdapter } from './browserbase.js';
import { flyioAdapter } from './flyio.js';
import { northflankAdapter } from './northflank.js';
import { cloudflareAdapter } from './cloudflare.js';
import { webcontainersAdapter } from './webcontainers.js';

export const SANDBOX_PROVIDER_ADAPTERS: Record<
  Exclude<SandboxBackend, 'local' | 'docker' | 'custom'>,
  SandboxProviderAdapter
> = {
  e2b: e2bAdapter,
  vercel: vercelAdapter,
  modal: modalAdapter,
  daytona: daytonaAdapter,
  browserbase: browserbaseAdapter,
  flyio: flyioAdapter,
  northflank: northflankAdapter,
  cloudflare: cloudflareAdapter,
  webcontainers: webcontainersAdapter,
};

export function getSandboxProviderAdapter(id: SandboxBackend): SandboxProviderAdapter | undefined {
  if (id === 'local' || id === 'docker' || id === 'custom') return undefined;
  return SANDBOX_PROVIDER_ADAPTERS[id];
}

export {
  e2bAdapter,
  vercelAdapter,
  modalAdapter,
  daytonaAdapter,
  browserbaseAdapter,
  flyioAdapter,
  northflankAdapter,
  cloudflareAdapter,
  webcontainersAdapter,
};
