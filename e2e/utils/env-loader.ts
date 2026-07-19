import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from workspace root
config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Get an environment variable with optional fallback.
 * Throws if required and not set.
 */
export function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Check if a given env var is set (non-empty).
 */
export function hasEnv(key: string): boolean {
  return !!process.env[key]?.trim();
}

// Commonly used keys
export const ENV_KEYS = {
  AI_GATEWAY_APIKEY: 'AI_GATEWAY_APIKEY',
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
  DEEPSEEK_API_KEY: 'DEEPSEEK_API_KEY',
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  PINECONE_INDEX_NAME: 'PINECONE_INDEX_NAME',
  PINECONE_APIKEY: 'PINECONE_APIKEY',
  CHROMA_TENANT: 'CHROMA_TENANT',
  CHROMA_API_KEY: 'CHROMA_API_KEY',
  CHROMA_DB: 'CHROMA_DB',
  FIRECRAWL_CLOUD_API_KEY: 'FIRECRAWL_CLOUD_API_KEY',
  SERPER_API_KEY: 'SERPER_API_KEY',
} as const;
