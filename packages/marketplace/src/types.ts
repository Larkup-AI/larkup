/**
 * Marketplace type contracts.
 *
 * These types define the plugin/tool system that powers the Larkup Hub.
 * Tools are optional features users can install from the marketplace UI.
 * The architecture is designed so the hub can later be served from a
 * remote API (subscription checks, remote registry, etc.) while the
 * local runtime stays identical.
 */

/* ------------------------------------------------------------------ */
/* Tool lifecycle                                                      */
/* ------------------------------------------------------------------ */

export type ToolStatus = 'available' | 'installing' | 'installed' | 'error';

export type ToolCategory =
  | 'media'
  | 'search'
  | 'analytics'
  | 'integration'
  | 'embedding'
  | 'ai'
  | 'automation'
  | 'utility';

export type ToolPricing = 'free' | 'pro' | 'enterprise';

/* ------------------------------------------------------------------ */
/* Tool descriptor (the registry entry / manifest schema)              */
/* ------------------------------------------------------------------ */

/**
 * The canonical shape for every marketplace tool. Each tool defines
 * one of these — either hardcoded in the registry or loaded from a
 * `tool.manifest.json` file inside the package (future).
 *
 * Schema version: 1.0
 */
export interface ToolDescriptor {
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

  /* ---- Icon system (priority: emoji > iconUrl > icon) ------------ */

  /** Emoji icon for lightweight display (e.g., "🎬"). Primary choice. */
  emoji?: string;
  /**
   * URL or path to a custom icon image (PNG/SVG/WebP).
   * Future: will be served from CDN via the API gateway.
   */
  iconUrl?: string;
  /** Lucide icon name — fallback when no emoji/image is set */
  icon: string;

  /* ---- Package metadata ------------------------------------------ */

  /** npm package name or "built-in" */
  packageName: string;
  /** Approximate install size for user display */
  installSize: string;
  /** System dependencies required (e.g., "ffmpeg") */
  systemDeps?: string[];
  /** Author / publisher */
  author: string;

  /* ---- Capabilities & config ------------------------------------- */

  /** Features this tool provides (used by core to route work) */
  capabilities: string[];
  /** Tool-specific configuration schema */
  configSchema?: ToolConfigField[];

  /* ---- Marketplace metadata -------------------------------------- */

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

  /* ---- Flags ----------------------------------------------------- */

  /** Whether this tool is a placeholder (coming soon) */
  comingSoon?: boolean;
}

export interface ToolConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'toggle';
  defaultValue?: string;
  help?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
}

/* ------------------------------------------------------------------ */
/* Installed tool state (persisted to disk)                            */
/* ------------------------------------------------------------------ */

export interface InstalledTool {
  id: string;
  version: string;
  installedAt: string;
  /** Resolved path to the installed package */
  packagePath: string;
  /** User-provided configuration values */
  config: Record<string, any>;
}

export interface InstalledToolsManifest {
  tools: InstalledTool[];
  /** Per-tool download/install counts (keyed by tool id) */
  downloadCounts: Record<string, number>;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Install progress                                                    */
/* ------------------------------------------------------------------ */

export type InstallStage =
  | 'checking-deps'
  | 'downloading'
  | 'installing'
  | 'configuring'
  | 'completed'
  | 'failed';

export interface InstallProgress {
  toolId: string;
  stage: InstallStage;
  /** 0–100 */
  percent: number;
  message: string;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Storage provider abstraction                                        */
/* ------------------------------------------------------------------ */

/**
 * Abstraction over where media files are stored. Ships with a local
 * provider; cloud providers (S3, UploadThing, GCS) can be added later
 * without changing any upstream code.
 */
export interface StorageProvider {
  id: string;
  name: string;
  /** Store a file and return a resolvable URI */
  store(key: string, data: Buffer, mimeType: string): Promise<string>;
  /** Retrieve a file by its storage URI */
  retrieve(uri: string): Promise<Buffer>;
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
