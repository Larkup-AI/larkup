import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../core/package.json', import.meta.url));
const { generateText } = await import(require.resolve('ai'));
const { createGateway } = await import(require.resolve('@ai-sdk/gateway'));

try {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const fetcher = input.proxy ? async (url, init) => {
    const headers = new Headers(init.headers);
    headers.set('X-Benchmark-Target', String(url));
    headers.set('X-Benchmark-Account', input.accountAlias);
    headers.set('X-Benchmark-Attempt', input.attemptId);
    headers.set('X-Benchmark-Capability', input.capability);
    return fetch(input.proxy + '/forward', { ...init, headers });
  } : globalThis.fetch;
  const gateway = createGateway({ apiKey: input.apiKey, fetch: fetcher });
  const result = await generateText({ model: gateway(input.model),
    messages: [{ role: 'user', content: [{ type: 'file', data: await readFile(input.sourcePath), mediaType: 'video/mp4' },
                                        { type: 'text', text: input.prompt }] }],
    maxOutputTokens: input.maxOutputTokens, temperature: input.temperature, maxRetries: 0,
    abortSignal: AbortSignal.timeout(180000) });
  const usage = result.totalUsage;
  process.stdout.write(JSON.stringify({ model: result.response.modelId ?? input.model,
    choices: [{ message: { content: result.text } }], usage: {
      prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens,
      reasoning_tokens: usage.outputTokenDetails?.reasoningTokens,
      cost: result.providerMetadata?.gateway?.cost ?? null } }));
} catch (error) {
  process.stdout.write(JSON.stringify({ benchmarkError: 'GATEWAY_NATIVE_FAILED', status: error.statusCode ?? null }));
  process.exitCode = 1;
}
