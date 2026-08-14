/**
 * Hub API types.
 *
 * These are kept in-app (not imported from @larkup/marketplace) to
 * avoid a monorepo dependency — the Hub is deployed independently.
 * They mirror the marketplace types but are self-contained.
 */

/* ------------------------------------------------------------------ */
/* Tool descriptor (mirrors @larkup/marketplace/types)                 */
/* ------------------------------------------------------------------ */

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

export interface ToolConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'toggle';
  defaultValue?: string;
  help?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
}

export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  category: ToolCategory;
  version: string;
  pricing: ToolPricing;
  emoji?: string;
  iconUrl?: string;
  icon: string;
  packageName: string;
  installSize: string;
  systemDeps?: string[];
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
}

/* ------------------------------------------------------------------ */
/* API response types                                                  */
/* ------------------------------------------------------------------ */

export interface ToolListResponse {
  tools: ToolDescriptor[];
  total: number;
}

export interface ToolDetailResponse {
  tool: ToolDescriptor;
  installs: number;
  versions: { version: string; publishedAt: string }[];
}

export interface PublishRequest {
  manifest: ToolDescriptor;
  /** Optional API key for authenticated publishing */
  apiKey?: string;
}
