import type { SandboxBackend, SandboxProviderDescriptor } from './types.js';

/**
 * Declarative registry of the remote sandbox providers @larkup/sandbox can
 * execute code on, besides the always-available local Docker backend.
 *
 * This single object powers two consumers:
 *  1. The Settings UI — renders `fields` dynamically so each provider asks
 *     for exactly the credentials it needs, the same way vector store and
 *     embedding provider fields are rendered from their own registries.
 *  2. `SandboxManager` / the provider adapters — read `id` to route
 *     execution and `executionSupport` to fail fast with a clear message
 *     instead of pretending every provider can run arbitrary code.
 *
 * Adding a new provider = one entry here + one adapter in `./providers`.
 */
export const SANDBOX_PROVIDERS: Record<
  Exclude<SandboxBackend, 'local' | 'docker' | 'custom'>,
  SandboxProviderDescriptor
> = {
  e2b: {
    id: 'e2b',
    label: 'E2B',
    description:
      'Firecracker-microVM sandboxes purpose-built for AI code execution, with fast cold starts.',
    sdkPackage: 'e2b',
    docsUrl: 'https://docs.e2b.dev/',
    icon: '/icons/e2b.png',
    executionSupport: 'full',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        placeholder: 'e2b_...',
        help: 'From the E2B dashboard. Equivalent to the E2B_API_KEY environment variable.',
      },
      {
        key: 'snapshotId',
        label: 'Snapshot or template ID',
        type: 'text',
        required: false,
        help: 'Optional prebuilt environment with your required packages. New executions start from it.',
      },
    ],
  },

  vercel: {
    id: 'vercel',
    label: 'Vercel Sandbox',
    description:
      'Isolated Firecracker microVMs for running arbitrary or untrusted code, billed through your Vercel account.',
    sdkPackage: '@vercel/sandbox',
    docsUrl: 'https://vercel.com/docs/sandbox',
    icon: '/icons/vercel.svg',
    executionSupport: 'full',
    fields: [
      {
        key: 'token',
        label: 'Access token',
        type: 'password',
        required: true,
        secret: true,
        help: 'Vercel access token with Sandbox permissions. Equivalent to VERCEL_TOKEN.',
      },
      {
        key: 'teamId',
        label: 'Team ID',
        type: 'text',
        required: true,
        placeholder: 'team_...',
        help: 'Found in Vercel Team Settings. Equivalent to VERCEL_TEAM_ID.',
      },
      {
        key: 'projectId',
        label: 'Project ID',
        type: 'text',
        required: true,
        placeholder: 'prj_...',
        help: 'The Vercel project sandboxes run under. Equivalent to VERCEL_PROJECT_ID.',
      },
      {
        key: 'snapshotId',
        label: 'Snapshot ID',
        type: 'text',
        required: false,
        help: 'Optional Vercel snapshot to restore for each execution.',
      },
    ],
  },

  modal: {
    id: 'modal',
    label: 'Modal',
    description:
      'Sandboxes for executing untrusted user or agent code in secure containers on Modal’s compute platform.',
    sdkPackage: 'modal',
    docsUrl: 'https://modal.com/docs/guide/sandboxes',
    icon: '/icons/modal.png',
    executionSupport: 'full',
    fields: [
      {
        key: 'tokenId',
        label: 'Token ID',
        type: 'text',
        required: true,
        placeholder: 'ak-...',
        help: 'From `modal setup` or the Modal dashboard. Equivalent to MODAL_TOKEN_ID.',
      },
      {
        key: 'tokenSecret',
        label: 'Token secret',
        type: 'password',
        required: true,
        secret: true,
        placeholder: 'as-...',
        help: 'Equivalent to MODAL_TOKEN_SECRET.',
      },
    ],
  },

  daytona: {
    id: 'daytona',
    label: 'Daytona',
    description:
      'Elastic infrastructure for running AI-generated code in fast, isolated sandboxes.',
    sdkPackage: '@daytona/sdk',
    docsUrl: 'https://www.daytona.io/docs/en/sandboxes/',
    icon: '/icons/daytonaio.png',
    executionSupport: 'full',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        help: 'From the Daytona dashboard. Equivalent to DAYTONA_API_KEY.',
      },
      {
        key: 'apiUrl',
        label: 'API URL',
        type: 'text',
        required: false,
        placeholder: 'https://app.daytona.io/api',
        help: 'Only needed for a self-hosted Daytona instance.',
      },
      {
        key: 'snapshot',
        label: 'Snapshot',
        type: 'text',
        required: false,
        help: 'Optional Daytona snapshot containing the dependencies your agent needs.',
      },
    ],
  },

  browserbase: {
    id: 'browserbase',
    label: 'Browserbase',
    description: 'Headless-Chrome browser sessions for Playwright/Puppeteer automation.',
    sdkPackage: '@browserbasehq/sdk',
    docsUrl: 'https://docs.browserbase.com/welcome/introduction',
    icon: '/icons/browserbase.png',
    executionSupport: 'unsupported',
    executionCaveat:
      'Browserbase provisions remote browser sessions reachable over CDP for Playwright/Puppeteer — it does not run arbitrary Python/JS and return stdout the way a code-execution sandbox does. Verify still checks your API key and project, but code-execution tools (data analysis, corpus analytics) need a different provider.',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        help: 'Equivalent to BROWSERBASE_API_KEY.',
      },
      {
        key: 'projectId',
        label: 'Project ID',
        type: 'text',
        required: true,
        help: 'Equivalent to BROWSERBASE_PROJECT_ID.',
      },
    ],
  },

  flyio: {
    id: 'flyio',
    label: 'Fly.io Sprites',
    description:
      'Persistent, fast-suspending Linux VM sandboxes for AI agents, built on Fly Machines.',
    sdkPackage: '@fly/sprites',
    docsUrl: 'https://fly.io/sprites/',
    icon: '/icons/flyio.jpeg',
    executionSupport: 'full',
    fields: [
      {
        key: 'token',
        label: 'Sprite token',
        type: 'password',
        required: true,
        secret: true,
        help: 'From `sprite org auth` or the Fly dashboard. Equivalent to SPRITE_TOKEN.',
      },
    ],
  },

  northflank: {
    id: 'northflank',
    label: 'Northflank',
    description: 'On-demand sandbox containers running as Northflank services in your own project.',
    sdkPackage: '@northflank/js-client',
    docsUrl: 'https://northflank.com/docs/v1/application/sandboxes/sandboxes-on-northflank',
    icon: '/icons/Northflank.png',
    executionSupport: 'full',
    fields: [
      {
        key: 'token',
        label: 'API token',
        type: 'password',
        required: true,
        secret: true,
        help: 'A personal or team API token from Northflank → Account → API Tokens.',
      },
      {
        key: 'projectId',
        label: 'Project ID',
        type: 'text',
        required: true,
        help: 'The Northflank project sandbox services are created in.',
      },
    ],
  },

  cloudflare: {
    id: 'cloudflare',
    label: 'Cloudflare Sandbox',
    description:
      'Container sandboxes running inside a Cloudflare Worker via the Durable Object Sandbox SDK.',
    sdkPackage: '@cloudflare/sandbox',
    docsUrl: 'https://developers.cloudflare.com/sandbox/',
    icon: '/icons/cloudflare.png',
    executionSupport: 'unsupported',
    executionCaveat:
      '@cloudflare/sandbox only runs inside a Cloudflare Worker through a Durable Object binding declared in wrangler config. There is no external REST API to create or run commands in a sandbox from this server. Verify checks your account API token; actually running code here requires deploying a Worker with the Sandbox binding.',
    fields: [
      {
        key: 'apiToken',
        label: 'API token',
        type: 'password',
        required: true,
        secret: true,
        help: 'Used only to verify account access.',
      },
      {
        key: 'accountId',
        label: 'Account ID',
        type: 'text',
        required: true,
      },
    ],
  },

  webcontainers: {
    id: 'webcontainers',
    label: 'WebContainers',
    description: 'In-browser WebAssembly Node.js runtime for running full-stack apps client-side.',
    sdkPackage: '@webcontainer/api',
    docsUrl: 'https://webcontainers.io/',
    icon: '/icons/webcontainers.svg',
    executionSupport: 'unsupported',
    executionCaveat:
      'WebContainers boots entirely inside a cross-origin-isolated browser tab (it needs SharedArrayBuffer). There is no Node.js/server-side way to run it, so this backend cannot execute code from here. Use @webcontainer/api directly in your frontend for in-browser execution instead.',
    fields: [
      {
        key: 'apiKey',
        label: 'License key (optional)',
        type: 'password',
        required: false,
        secret: true,
        help: 'StackBlitz-issued commercial key for production embeds. Leave blank for local/prototype use.',
      },
    ],
  },
};

export const SANDBOX_PROVIDER_LIST: SandboxProviderDescriptor[] = Object.values(SANDBOX_PROVIDERS);

export function getSandboxProvider(id: SandboxBackend): SandboxProviderDescriptor | undefined {
  if (id === 'local' || id === 'docker' || id === 'custom') return undefined;
  return SANDBOX_PROVIDERS[id];
}

/** Validates credentials against a provider's registered fields, mirroring validateStoreConfig. */
export function validateSandboxCredentials(
  provider: SandboxProviderDescriptor,
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of provider.fields) {
    if (field.required && !values[field.key]?.trim()) {
      errors[field.key] = `${field.label} is required`;
    }
  }
  return errors;
}
