/**
 * Hub API types.
 *
 * These are kept in-app (not imported from @larkup/marketplace) to
 * avoid a monorepo dependency — the Hub is deployed independently.
 * They mirror the marketplace types but are self-contained.
 */

/* Tool descriptor (mirrors @larkup/marketplace/types)                 */

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
export type ToolDistribution = 'public' | 'private';

export interface ToolConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'toggle';
  defaultValue?: string;
  help?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  providerField?: string;
  defaultValueByProvider?: Record<string, string>;
  globalConfigKey?: 'visionProvider' | 'chatProvider';
  defaultFromGlobalConfigKey?: 'visionProvider' | 'chatProvider';
}

export interface ToolDescriptor {
  manifestVersion?: '1.0' | '2.0' | '3.0';
  kind?: 'tool';
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  category: ToolCategory;
  version: string;
  pricing: ToolPricing;
  distribution?: ToolDistribution;
  emoji?: string;
  iconUrl?: string;
  icon: string;
  packageName: string;
  installSize: string;
  systemDeps?: string[];
  /** Defaults to true when a publisher omits it for backwards compatibility. */
  requiresSandbox?: boolean;
  author: string;
  capabilities: string[];
  configSchema?: ToolConfigField[];
  tags?: string[];
  downloads: number;
  repositoryUrl?: string;
  license?: string;
  changelog?: string;
  minLarkupVersion?: string;
  updatedAt?: string;
  comingSoon?: boolean;
  trustLevel?: 'sandboxed' | 'elevated';
  permissions?: Record<string, unknown>;
  entrypoints?: Record<string, string>;
  runtime?: Record<string, unknown>;
  billing?: Record<string, unknown>;
  ui?: Record<string, unknown>;
}

/* API response types                                                  */

export interface ToolListResponse {
  tools: ToolDescriptor[];
  total: number;
}

export interface ToolDetailResponse {
  tool: ToolDescriptor;
  installs: number;
  versions: { version: string; publishedAt: string }[];
  /** Whether the caller's workspace may install this tool right now. Always true for public tools. */
  authorized: boolean;
}

export interface PublishRequest {
  manifest: ToolDescriptor;
  /** Optional API key for authenticated publishing */
  apiKey?: string;
}
