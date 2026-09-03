/**
 * Marketplace type contracts.
 */

export type ToolStatus = 'available' | 'installing' | 'installed' | 'error';

export type ToolCategory =
  'media' | 'search' | 'analytics' | 'integration' | 'embedding' | 'ai' | 'automation' | 'utility';

export type ToolPricing = 'free' | 'pro' | 'enterprise';
/** Controls who can discover and install a published Marketplace tool. */
export type ToolDistribution = 'public' | 'private';

/** A native process is a local runtime launched without a container engine. */
export type ToolRuntimeMode =
  'local' | 'local-docker' | 'local-process' | 'managed-cloud' | 'custom-remote';

export interface ToolRuntimeModeDescriptor {
  id: ToolRuntimeMode;
  label: string;
  description: string;
  /** Optional visual mark shown by host runtime pickers. */
  icon?: string;
  /** Config field that contains the remote endpoint for remote modes. */
  endpointConfigKey?: string;
  /** Config field that contains the bearer credential for remote modes. */
  credentialConfigKey?: string;
  /** OCI image used by a local or self-hosted runtime. */
  image?: string;
  /** Relative path to a compose file shipped by the npm package. */
  composeFile?: string;
  requiresGpu?: boolean;
  /** Shown before a local runtime is enabled, e.g. its image download size. */
  setupNotice?: string;
}

export interface ToolRuntimeDescriptor {
  protocolVersion: string;
  defaultMode: ToolRuntimeMode;
  modes: ToolRuntimeModeDescriptor[];
  healthPath?: string;
}

export interface ToolEntrypoints {
  /** Server-safe module export containing the ToolExtension contract. */
  server: string;
  /** Optional agent tool registration export. */
  agent?: string;
  /** Optional browser bundle. Third-party bundles must be sandboxed by the host. */
  ui?: string;
}

export interface ToolMeterDescriptor {
  id: string;
  unit: string;
  description: string;
}

export interface ToolBillingDescriptor {
  model: 'free' | 'subscription' | 'usage' | 'hybrid';
  meters: ToolMeterDescriptor[];
  /** Billing stays provider-neutral; a future payment service maps plans to entitlements. */
  entitlementVersion: string;
}

export interface ToolUsageField {
  key: string;
  label: string;
  format?: 'number' | 'minutes';
}

export interface ToolUsageVisualization {
  usedKey: string;
  limitKey: string;
}

/** Tool-declared support request metadata rendered by the generic host UI. */
export interface ToolUsageSupport {
  contactLabel?: string;
  description?: string;
  /** Config key containing the safe-to-share installation identifier. */
  userIdConfigKey?: string;
}

/** Declarative usage values a tool client exposes through the host. */
export interface ToolUsageDescriptor {
  label?: string;
  fields: ToolUsageField[];
  /** Limit a metered usage panel to the runtime modes where it applies. */
  visibleWhenRuntimeMode?: ToolRuntimeMode[];
  visualization?: ToolUsageVisualization;
  support?: ToolUsageSupport;
}

export interface ToolUiSurface {
  id: string;
  slot: 'data-indexing' | 'settings' | 'chat-result' | 'asset-actions';
  title: string;
  description?: string;
  entrypoint?: string;
  /** Media kinds a data-indexing surface can collect inputs for. */
  appliesTo?: Array<'image' | 'video' | 'audio'>;
  /** Declarative form rendered by the host; tool code and copy stay with the tool. */
  form?: {
    submitLabel?: string;
    fields: Array<{
      key: string;
      type: 'textarea' | 'select' | 'checkbox';
      label: string;
      description?: string;
      placeholder?: string;
      defaultValue?: string | boolean;
      options?: Array<{
        label: string;
        value: string;
        description?: string;
        /** Declarative companion values selected with this option. */
        setValues?: Record<string, string | boolean>;
      }>;
      requiredWhen?: { field: string; equals: string | boolean };
    }>;
  };
  /**
   * Optional, tool-declared workload estimates. The host supplies the source
   * duration and renders these provider-neutral values in its generic form.
   */
  estimate?: {
    modeField: string;
    variants: Array<{
      value: string;
      analyzedFramesPerSourceMinute: number;
      ocrFramesPerSourceMinute: number;
      processingSecondsPerSourceMinute: number;
      maxProcessingSecondsPerSourceMinute?: number;
      fixedOverheadSeconds?: number;
      maxFixedOverheadSeconds?: number;
      creditsPerSourceMinute: number;
    }>;
  };
}

export interface ToolUiDescriptor {
  isolation: 'sandboxed-iframe' | 'host';
  surfaces: ToolUiSurface[];
}

export interface ToolPermissions {
  fsRead?: boolean;
  fsWrite?: boolean;
  exec?: boolean;
  httpAllow?: string[];
}

/**
 * The canonical shape for every marketplace tool.
 */
export interface ToolDescriptor {
  manifestVersion?: '1.0' | '2.0' | '3.0';
  kind?: 'tool';
  /** Unique identifier: "video-audio", "clip-embeddings", etc. */
  id: string;
  /** User-facing display name */
  name: string;
  /** Short one-line description */
  description: string;
  /** Longer description shown in detail view */
  longDescription?: string;
  category: ToolCategory;
  version: string;
  /** Current pricing tier — "free" for all launch tools */
  pricing: ToolPricing;
  /** Public tools are catalog-visible; private tools require a Hub workspace grant. */
  distribution?: ToolDistribution;

  /** Emoji icon for lightweight display (e.g., "🎬"). Primary choice. */
  emoji?: string;
  /**
   * URL or path to a custom icon image (PNG/SVG/WebP).
   * Future: will be served from CDN via the API gateway.
   */
  iconUrl?: string;
  /** Lucide icon name — fallback when no emoji/image is set */
  icon: string;

  /** npm package name or "built-in" */
  packageName: string;
  /** Approximate install size for user display */
  installSize: string;
  /** System dependencies required (e.g., "ffmpeg") */
  systemDeps?: string[];
  /**
   * Whether this tool must run in an isolated code-execution sandbox. Omitted
   * legacy manifests are normalized to `true` by the Hub.
   */
  requiresSandbox?: boolean;
  /** Author / publisher */
  author: string;

  /** Features this tool provides (used by core to route work) */
  capabilities: string[];
  /** Tool-specific configuration schema */
  configSchema?: ToolConfigField[];

  /** Tags for search and filtering (e.g., ["transcription", "ffmpeg"]) */
  tags?: string[];
  /** Total download/install count (local tracking; future: remote API) */
  downloads: number;
  /** Repository or homepage URL — enables collaboration */
  repositoryUrl?: string;
  /** License type (e.g., "MIT", "Apache-2.0") */
  license?: string;
  /** Changelog / what's new in this version */
  changelog?: string;
  /** Minimum Larkup version required */
  minLarkupVersion?: string;
  /** Last updated date (ISO 8601) */
  updatedAt?: string;

  /** Whether this tool is a placeholder (coming soon) */
  comingSoon?: boolean;
  trustLevel?: 'sandboxed' | 'elevated';
  permissions?: ToolPermissions;
  /** Optional v3 extension entrypoints loaded only after installation. */
  entrypoints?: ToolEntrypoints;
  /** Local Docker, managed cloud, and custom remote runtime choices. */
  runtime?: ToolRuntimeDescriptor;
  /** Provider-neutral metering contract for subscriptions and pay-as-you-go. */
  billing?: ToolBillingDescriptor;
  /** Optional, manifest-driven usage summary for installed-tool settings. */
  usage?: ToolUsageDescriptor;
  /** UI surfaces contributed by the installed tool. */
  ui?: ToolUiDescriptor;
}

export interface ToolConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'toggle';
  defaultValue?: string;
  help?: string;
  required?: boolean;
  options?: ToolConfigOption[];
  /** For a model selector, the provider field used to filter its options. */
  providerField?: string;
  /** Provider-specific defaults used when the saved model belongs to another provider. */
  defaultValueByProvider?: Record<string, string>;
  /** Optional host AI Models key used as this field's unsaved default. */
  globalConfigKey?: 'visionProvider' | 'chatProvider';
  /** Uses a workspace AI setting as the unsaved default without writing to it. */
  defaultFromGlobalConfigKey?: 'visionProvider' | 'chatProvider' | 'visionModelId' | 'chatModelId';
  /** Optional visual group. Settings forms render each group in its own card. */
  group?: string;
  /** Declarative verification request. Omit it to hide Verify for this field. */
  verification?: ToolConfigVerification;
  /** Preferred desktop width in a schema-driven settings grid. */
  layout?: 'full' | 'half';
  /** Render this field only when another configuration field has a matching value. */
  visibleWhen?: {
    field: string;
    equals: string | boolean | Array<string | boolean>;
  };
  /**
   * Set by the tool's own backend (e.g. device provisioning), never by the
   * client. Settings forms must not render an input for it, and config
   * saves must not let a client request overwrite or clear it.
   */
  serverManaged?: boolean;
  /** Render a server-managed value as a non-editable status value. */
  readOnly?: boolean;
}

export interface ToolConfigOption {
  label: string;
  value: string;
  /** Short text shown with the option; longer text moves into the hover hint. */
  description?: string;
  icon?: string;
  image?: string;
}

export interface ToolConfigVerification {
  endpoint: string;
  method?: 'POST' | 'PUT';
  /** Maps request keys to config field keys. "$value" is the current field. */
  fields?: Record<string, string>;
}
export type ToolSource = 'registry' | 'local' | 'sandbox';

export interface InstalledTool {
  id: string;
  version: string;
  installedAt: string;
  /** npm package name (e.g., "@larkup/tool-video-audio") */
  packageName: string;
  /** Absolute path to the resolved module entry point. */
  resolvedPath: string;
  /** Where this tool was installed from */
  source: ToolSource;
  /** User-provided configuration values */
  config: Record<string, any>;
}

export interface InstalledToolsManifest {
  tools: InstalledTool[];
  /** Per-tool download/install counts (keyed by tool id) */
  downloadCounts: Record<string, number>;
  updatedAt: string;
}

export type InstallStage =
  'checking-deps' | 'downloading' | 'installing' | 'configuring' | 'completed' | 'failed';

export interface InstallProgress {
  toolId: string;
  stage: InstallStage;
  /** 0–100 */
  percent: number;
  message: string;
  error?: string;
}

/**
 * Determines how tool installation and loading behaves.
 */
export type DeploymentTarget = 'local' | 'docker' | 'serverless' | 'sandbox';

export interface HubConfig {
  /** Base URL of the Hub API (e.g., "https://hub.larkup.de") */
  baseUrl: string;
  /** Optional API key for authenticated requests */
  apiKey?: string;
}

/** Default Hub API URL. Can be overridden via LARKUP_HUB_URL env var. */
export const DEFAULT_HUB_URL = process.env.LARKUP_HUB_URL ?? 'https://hub.larkup.de';

export interface StorageProvider {
  id: string;
  name: string;
  /** Store a file and return a resolvable URI */
  store(key: string, data: Buffer, mimeType: string): Promise<string>;
  /** Store an existing local file without buffering it in memory, when supported. */
  storeFile?(key: string, sourcePath: string, mimeType: string): Promise<string>;
  /** Retrieve a file by its storage URI */
  retrieve(uri: string): Promise<Buffer>;
  /** Resolve a URI to a local file without buffering it in memory, when supported. */
  resolvePath?(uri: string): Promise<string | undefined>;
  /**
   * A short-lived, range-capable HTTPS URL for this file, when the backing
   * store supports direct remote access (S3). A bounded caller (FFmpeg
   * seeking a range for watch_original, a remote GPU worker) can fetch just
   * the bytes it needs through this URL instead of a full local download.
   * Absent for stores with no such notion (local disk) -- callers fall back
   * to resolvePath/retrieve.
   */
  getReadUrl?(uri: string, expiresInSecs: number): Promise<string | undefined>;
  /** Delete a file by its storage URI */
  delete(uri: string): Promise<void>;
  /** Get storage usage stats */
  stats(): Promise<StorageStats>;
}

export interface StorageStats {
  usedBytes: number;
  fileCount: number;
  /** If set, storage has a configured limit */
  limitBytes?: number;
}

/** Thresholds for storage warnings (in bytes) */
export const STORAGE_WARNING_THRESHOLDS = [
  1 * 1024 * 1024 * 1024, // 1 GB
  5 * 1024 * 1024 * 1024, // 5 GB
  10 * 1024 * 1024 * 1024, // 10 GB
] as const;
