/**
 * Gateway fallback models are deliberately spread across providers. This lets
 * AI Gateway recover from an unavailable or throttled primary model without
 * making the browser retry the same request several times.
 */
export const GATEWAY_FALLBACK_MODELS = [
  'google/gemini-2.5-flash',
  'openai/gpt-4o-mini',
  'meta/llama-4-maverick',
] as const;

export function gatewayProviderOptions(provider: string, primaryModelId: string) {
  if (provider !== 'vercel_ai_gateway') return undefined;

  const models = GATEWAY_FALLBACK_MODELS.filter((model) => model !== primaryModelId);
  return models.length > 0 ? { gateway: { models } } : undefined;
}
