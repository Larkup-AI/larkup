/**
 * The server source emitted into an Agent Runtime bundle.
 *
 * Kept in its own module because it is a *string of JavaScript*, not TypeScript
 * the monorepo compiles: the bundle must run on a bare Node image with no
 * Larkup packages installed, on any of the targets in plan §11.1.
 *
 * The generated server deliberately mirrors the dashboard's behaviour for the
 * endpoints the provider acceptance matrix (§11.2) checks — health, readiness,
 * redacted public config, streamed chat behind the origin allow-list, the
 * widget, and channel inbound — so "works locally" and "works deployed" mean
 * the same thing.
 */

/** `server.mjs` — the whole runtime, driven by `release.json`. */
export function agentRuntimeServerSource(): string {
  return String.raw`import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { streamText, generateText, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';

/* ------------------------------------------------------------------ */
/* Release snapshot — the portable artifact (ADR-002)                  */
/* ------------------------------------------------------------------ */

const release = JSON.parse(await readFile(new URL('./release.json', import.meta.url), 'utf8'));
const agent = release.definition;

const PORT = Number(process.env.PORT || 8080);
const TARGET = process.env.LARKUP_EXEC_TARGET || 'docker';
const STARTED_AT = Date.now();

/* ------------------------------------------------------------------ */
/* Observability (plan §12)                                            */
/* ------------------------------------------------------------------ */

const SECRET_KEY = /(token|secret|key|password|authorization|credential|cookie|signature)/i;
const SECRET_VALUES = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\d{6,}:[A-Za-z0-9_-]{30,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
];

function redact(value, depth = 0) {
  if (depth > 6) return '[redacted]';
  if (typeof value === 'string') {
    let out = value;
    for (const p of SECRET_VALUES) out = out.replace(p, '[redacted]');
    return out;
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function emit(name, correlation, options = {}) {
  const level = options.level ?? (name.endsWith('failed') || name.endsWith('denied') ? 'warn' : 'info');
  const event = {
    name,
    timestamp: new Date().toISOString(),
    level,
    correlation: { agentId: agent.id, releaseId: release.releaseId, ...correlation },
    ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
    ...(options.payload ? { payload: redact(options.payload) } : {}),
  };
  const line = JSON.stringify(event);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/* ------------------------------------------------------------------ */
/* Origin policy (mirrors @larkup/agent-contracts/origin)              */
/* ------------------------------------------------------------------ */

function normalizeOrigin(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === 'null') return null;
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return null;
  }
}

function defaultPort(scheme) {
  return scheme === 'https:' ? '443' : scheme === 'http:' ? '80' : null;
}

function hostMatches(pattern, host) {
  if (pattern === host) return true;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return false;
}

function originAllowed(origin, allowed) {
  const entries = (allowed || []).map((e) => String(e).trim()).filter(Boolean);
  if (entries.some((e) => e === '*')) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const url = new URL(normalized);
  const host = url.hostname.toLowerCase();
  const port = url.port || defaultPort(url.protocol);

  return entries.some((entry) => {
    const clean = entry.toLowerCase().replace(/\/+$/, '');
    const schemeMatch = /^([a-z][a-z0-9+.-]*:)\/\//.exec(clean);
    const scheme = schemeMatch ? schemeMatch[1] : null;
    let rest = (schemeMatch ? clean.slice(schemeMatch[0].length) : clean).split('/')[0];
    if (!rest) return false;
    if (scheme && scheme !== url.protocol) return false;

    let entryHost = rest;
    let entryPort = null;
    const portMatch = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(rest);
    if (portMatch) {
      entryHost = portMatch[1];
      entryPort = portMatch[2];
    }

    if (!hostMatches(entryHost, host)) return false;
    if (entryPort === null) return scheme ? port === defaultPort(scheme) : true;
    return entryPort === port;
  });
}

function checkOrigin(req, selfOrigin) {
  const origin = normalizeOrigin(req.headers.origin) ?? normalizeOrigin(req.headers.referer);
  if (!origin) return { allowed: true, origin: null, reason: 'no-origin' };
  if (normalizeOrigin(selfOrigin) === origin) return { allowed: true, origin, reason: 'same-origin' };

  const entries = (agent.allowedOrigins || []).filter(Boolean);
  if (entries.some((e) => e === '*')) return { allowed: true, origin, reason: 'wildcard' };
  if (entries.length === 0) return { allowed: false, origin, reason: 'empty-allow-list' };

  return originAllowed(origin, entries)
    ? { allowed: true, origin, reason: 'allow-listed' }
    : { allowed: false, origin, reason: 'not-allow-listed' };
}

function corsHeaders(decision) {
  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Larkup-Join-Code',
    'Access-Control-Max-Age': '86400',
  };
  // Set on denials too, so a blocked embed can show the reason instead of an
  // opaque "Failed to fetch". See ADR-009.
  if (decision.origin) headers['Access-Control-Allow-Origin'] = decision.origin;
  return headers;
}

/* ------------------------------------------------------------------ */
/* Rate limiting (mirrors @larkup/agent-contracts/rate-limit, plan §8.5) */
/* ------------------------------------------------------------------ */

const REQUESTS_PER_MINUTE = { capacity: 5, refillPerMs: 20 / 60000 };
const MESSAGES_PER_SESSION = { capacity: 50, refillPerMs: 0 };
const NO_REFILL_RETRY_SECONDS = 86400;
const rateBuckets = new Map();

function rateSweep(now) {
  if (rateBuckets.size < 4096) return;
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.updatedAt > 86400000) rateBuckets.delete(key);
  }
}

function rateRefill(key, config, now) {
  const existing = rateBuckets.get(key);
  return existing
    ? Math.min(config.capacity, existing.tokens + (now - existing.updatedAt) * config.refillPerMs)
    : config.capacity;
}

function rateConsume(key, cost, config) {
  const now = Date.now();
  rateSweep(now);
  const tokens = rateRefill(key, config, now);

  if (tokens >= cost) {
    const remaining = tokens - cost;
    rateBuckets.set(key, { tokens: remaining, updatedAt: now });
    return { allowed: true, remaining: Math.floor(remaining), retryAfterSeconds: 0 };
  }

  rateBuckets.set(key, { tokens, updatedAt: now });
  const deficit = cost - tokens;
  const retryAfterSeconds =
    config.refillPerMs > 0
      ? Math.max(1, Math.ceil(deficit / config.refillPerMs / 1000))
      : NO_REFILL_RETRY_SECONDS;
  return { allowed: false, remaining: Math.floor(Math.max(0, tokens)), retryAfterSeconds };
}

function rateCharge(key, cost, config) {
  const now = Date.now();
  rateSweep(now);
  const tokens = rateRefill(key, config, now);
  rateBuckets.set(key, { tokens: tokens - cost, updatedAt: now });
}

function dailyBucketConfig(capacity) {
  return { capacity, refillPerMs: capacity / 86400000 };
}

function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// Trust only the last X-Forwarded-For hop — the one the reverse proxy itself
// appended, which the client cannot spoof. See rate-limit.ts's doc comment.
function trustedClientIp(forwardedFor) {
  if (!forwardedFor) return 'unknown';
  const hops = String(forwardedFor).split(',').map((h) => h.trim()).filter(Boolean);
  return hops.length ? hops[hops.length - 1] : 'unknown';
}

function visitorKey(req) {
  const ip = trustedClientIp(req.headers['x-forwarded-for']);
  const ua = req.headers['user-agent'] || 'unknown';
  return fnv1a(agent.id + ' ' + ip + ' ' + ua);
}

function rateLimitResponse(res, decision, cors) {
  return json(
    res,
    429,
    { error: 'Too many requests. Try again shortly.' },
    {
      ...cors,
      'Retry-After': String(decision.retryAfterSeconds),
      'X-RateLimit-Remaining': String(Math.max(0, decision.remaining)),
    },
  );
}

/* ------------------------------------------------------------------ */
/* Wire protocol (mirrors @larkup/agent-contracts/protocol)            */
/* ------------------------------------------------------------------ */

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    let role = raw.role;
    if (role === 'ai' || role === 'bot' || role === 'model') role = 'assistant';
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;

    let content = typeof raw.content === 'string' ? raw.content.trim() : '';
    if (!content && Array.isArray(raw.parts)) {
      content = raw.parts
        .map((p) => (typeof p === 'string' ? p : p && (p.type === 'text' || p.type === undefined) ? (p.text ?? '') : ''))
        .join('')
        .trim();
    }
    if (!content) continue;
    out.push({ role, content });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

function resolveModel(provider, modelId) {
  const name = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
  const apiKey = process.env[provider.toUpperCase().replace(/-/g, '_') + '_API_KEY'];
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(name);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(name);
    case 'mistral':
      return createMistral({ apiKey })(name);
    default:
      return createOpenAI({ apiKey })(name);
  }
}

/* ------------------------------------------------------------------ */
/* Knowledge retrieval fan-out                                         */
/* ------------------------------------------------------------------ */

async function retrieve(query, topK = 5) {
  const sources = agent.knowledgeSources || [];
  if (!sources.length || !query) return [];

  const settled = await Promise.allSettled(
    sources.map(async (source) => {
      const key = process.env['KS_KEY_' + slug(source.label)] || source.retrievalKey;
      const res = await fetch(source.baseUrl.replace(/\/$/, '') + '/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ query, topK: source.topK ?? topK }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(source.label + ': HTTP ' + res.status);
      const data = await res.json();
      return (data.hits || []).map((h) => ({
        sourceLabel: source.label,
        score: h.score ?? 0,
        text: h.text ?? '',
        title: h.title,
      }));
    }),
  );

  const hits = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') hits.push(...r.value);
    else emit('run.failed', {}, { level: 'warn', payload: { retrieval: String(r.reason) } });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, topK * sources.length);
}

function slug(label) {
  return String(label).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function buildSystemPrompt(hits) {
  const prompt = (agent.systemPrompt || '').trim();
  if (!hits.length) return prompt;
  const context = hits
    .map((h, i) => '[Source ' + (i + 1) + (h.title ? ' — ' + h.title : '') + ']\n' + h.text.slice(0, 800))
    .join('\n\n---\n\n');
  return prompt + '\n\n## Relevant Knowledge\n\nUse the following context to answer. Cite sources by [Source N] when relevant.\n\n' + context;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

function checkAuth(req) {
  const mode = agent.authMode || 'none';
  if (mode === 'none') return null;

  if (mode === 'join-code') {
    const expected = process.env.AGENT_JOIN_CODE || agent.joinCode || '';
    if (!expected) return { status: 503, error: 'This agent requires a join code but none is configured.' };
    if (req.headers['x-larkup-join-code'] !== expected) {
      return { status: 401, error: 'A valid join code is required for this agent.' };
    }
    return null;
  }

  return { status: 501, error: 'authMode "api-key" is not enforceable in this runtime version.' };
}

/* ------------------------------------------------------------------ */
/* Channel inbound                                                     */
/* ------------------------------------------------------------------ */

const seenMessages = new Map();

function claimMessage(key, ttlMs = 600000) {
  const now = Date.now();
  if (seenMessages.size > 512) {
    for (const [k, expiry] of seenMessages) if (expiry <= now) seenMessages.delete(k);
  }
  const existing = seenMessages.get(key);
  if (existing !== undefined && existing > now) return false;
  seenMessages.set(key, now + ttlMs);
  return true;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Session transcripts, in memory. Bounded so a long chat cannot grow forever. */
const sessions = new Map();

function sessionHistory(sessionId) {
  return sessions.get(sessionId) || [];
}

function rememberTurn(sessionId, user, assistant) {
  const next = [...sessionHistory(sessionId), { role: 'user', content: user }, { role: 'assistant', content: assistant }];
  sessions.set(sessionId, next.slice(-20));
  if (sessions.size > 1000) sessions.delete(sessions.keys().next().value);
}

function parseChannelMessage(channelId, settings, headers, rawBody, body) {
  if (channelId === 'webhook') {
    const secret = settings.signingSecret || '';
    if (!secret) return { error: { status: 403, message: 'Channel has no signing secret.' } };

    const timestamp = headers['x-larkup-timestamp'];
    const signature = headers['x-larkup-signature'];
    if (!timestamp || !signature) return { error: { status: 401, message: 'Missing signature headers.' } };
    if (Math.abs(Date.now() - Number(timestamp)) > 300000) {
      return { error: { status: 401, message: 'Signature timestamp is stale.' } };
    }
    const expected = createHmac('sha256', secret).update(timestamp + '.' + rawBody).digest('hex');
    if (!safeEqual(expected, String(signature).trim().toLowerCase())) {
      return { error: { status: 401, message: 'Signature does not match.' } };
    }

    const text = typeof body?.message === 'string' ? body.message : body?.text;
    if (typeof text !== 'string' || !text.trim()) return { message: null };
    const conversationId = body?.conversationId || 'default';
    return {
      message: {
        id: body?.messageId || signature,
        conversationId,
        text: text.trim(),
        reply: null,
      },
    };
  }

  if (channelId === 'slack') {
    const secret = settings.signingSecret || '';
    if (!secret) return { error: { status: 403, message: 'Channel has no signing secret.' } };

    const timestamp = headers['x-slack-request-timestamp'];
    const signature = headers['x-slack-signature'];
    if (!timestamp || !signature) return { error: { status: 401, message: 'Missing Slack signature headers.' } };
    if (Math.abs(Date.now() - Number(timestamp) * 1000) > 300000) {
      return { error: { status: 401, message: 'Signature timestamp is stale.' } };
    }
    const expected = 'v0=' + createHmac('sha256', secret).update('v0:' + timestamp + ':' + rawBody).digest('hex');
    if (!safeEqual(expected, String(signature).trim())) {
      return { error: { status: 401, message: 'Signature does not match.' } };
    }

    // One-time handshake when an operator saves the Events API Request URL —
    // nothing to answer, just echo the challenge back.
    if (body?.type === 'url_verification' && typeof body.challenge === 'string') {
      return { challenge: body.challenge };
    }

    const event = body?.event;
    if (!event || event.type !== 'message' || event.subtype || event.bot_id) return { message: null };
    const text = (event.text || '').trim();
    if (!text || !event.channel || !event.user || !event.ts) return { message: null };

    return {
      message: {
        id: body.event_id || event.channel + ':' + event.ts,
        conversationId: event.channel,
        text,
        reply: { kind: 'slack', channel: event.channel },
      },
    };
  }

  if (channelId === 'telegram') {
    const expected = settings.webhookSecret || '';
    if (!expected) return { error: { status: 403, message: 'Channel has no webhook secret.' } };
    if (!safeEqual(expected, headers['x-telegram-bot-api-secret-token'] || '')) {
      return { error: { status: 401, message: 'Invalid Telegram secret token.' } };
    }

    const msg = body?.message;
    if (!msg || msg.from?.is_bot) return { message: null };
    const text = (msg.text || msg.caption || '').trim();
    const chatId = msg.chat?.id;
    if (!text || chatId === undefined) return { message: null };

    return {
      message: {
        id: String(body.update_id ?? chatId + ':' + msg.message_id),
        conversationId: String(chatId),
        text,
        reply: { kind: 'telegram', chatId },
      },
    };
  }

  return { error: { status: 404, message: 'Unknown channel "' + channelId + '".' } };
}

async function deliverChannelReply(reply, settings, text) {
  if (!reply) return { ok: true };

  if (reply.kind === 'telegram') {
    const token = settings.botToken;
    if (!token) return { ok: false, error: 'No bot token configured.' };
    // Telegram caps a message at 4096 characters.
    for (let i = 0; i < text.length; i += 4000) {
      const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: reply.chatId, text: text.slice(i, i + 4000) }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return { ok: false, error: 'Telegram API returned HTTP ' + res.status };
    }
  }

  if (reply.kind === 'slack') {
    const token = settings.botToken;
    if (!token) return { ok: false, error: 'No bot token configured.' };
    // Slack's Web API answers HTTP 200 even on failure; the real result is
    // in the JSON body's ok field.
    for (let i = 0; i < text.length; i += 39000) {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ channel: reply.channel, text: text.slice(i, i + 39000) }),
        signal: AbortSignal.timeout(15000),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        return { ok: false, error: 'Slack API error: ' + (payload?.error || 'HTTP ' + res.status) };
      }
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function publicConfig() {
  return {
    agentId: agent.id,
    name: agent.name,
    description: agent.description || undefined,
    status: 'ready',
    authMode: agent.authMode || 'none',
    widgetStyle: agent.widgetStyle,
    releaseId: release.releaseId,
    version: release.version,
  };
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const selfOrigin = url.origin;
  const path = url.pathname.replace(/\/+$/, '') || '/';

  /* ---- Liveness. Never gated: a probe has no Origin and no credentials. */
  if (path === '/health') {
    return json(res, 200, {
      status: 'ok',
      agentId: agent.id,
      releaseId: release.releaseId,
      version: release.version,
      uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    });
  }

  /* ---- Readiness: can this process actually answer a question? */
  if (path === '/readiness') {
    const provider = (agent.chatProvider || 'openai').toUpperCase().replace(/-/g, '_');
    const hasModelKey = Boolean(process.env[provider + '_API_KEY']);
    const checks = {
      release: Boolean(release.releaseId),
      modelCredential: hasModelKey,
      knowledgeSources: (agent.knowledgeSources || []).length,
    };
    const ready = checks.release && checks.modelCredential;
    return json(res, ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', checks });
  }

  if (path === '/') {
    return json(res, 200, {
      name: agent.name,
      agentId: agent.id,
      releaseId: release.releaseId,
      version: release.version,
      target: TARGET,
      endpoints: ['/health', '/readiness', '/agent', '/chat', '/widget.js', '/channels/:channelId'],
    });
  }

  /* ---- Widget bundle. Public: it contains no secret. */
  if (path === '/widget.js') {
    try {
      const code = await readFile(new URL('./widget.js', import.meta.url), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(code);
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/javascript; charset=utf-8' });
      return res.end('console.error("[Larkup] widget bundle missing from this deployment");');
    }
  }

  /* ---- Channel inbound. Provider-to-server: no Origin, verified by adapter. */
  if (path.startsWith('/channels/')) {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });

    const channelId = path.slice('/channels/'.length);
    const channel = (agent.channels || {})[channelId];
    if (!channel || !channel.enabled) {
      return json(res, 403, { error: 'The "' + channelId + '" channel is not enabled.' });
    }

    const rawBody = await readBody(req);
    let body;
    try {
      body = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      body = undefined;
    }

    const settings = { ...channel.settings };
    // A deployment may inject a rotated credential without republishing.
    for (const key of Object.keys(settings)) {
      const override = process.env['CHANNEL_' + channelId.toUpperCase() + '_' + slug(key)];
      if (override) settings[key] = override;
    }

    const parsed = parseChannelMessage(channelId, settings, req.headers, rawBody, body);
    if (parsed.error) {
      emit('security.auth_failed', { channelId }, { payload: { reason: parsed.error.message } });
      return json(res, parsed.error.status, { error: parsed.error.message });
    }
    // Slack's one-time url_verification handshake — nothing to dispatch.
    if (parsed.challenge) return json(res, 200, { challenge: parsed.challenge });
    if (!parsed.message) return json(res, 200, { ok: true, detail: 'ignored' });

    const key = channelId + ':' + parsed.message.id;
    if (!claimMessage(key)) return json(res, 200, { ok: true, detail: 'duplicate ignored' });

    const runId = randomUUID();
    const sessionId = channelId + ':' + parsed.message.conversationId;
    emit('channel.received', { channelId, runId, sessionId });

    try {
      const messages = [...sessionHistory(sessionId), { role: 'user', content: parsed.message.text }];
      const hits = await retrieve(parsed.message.text);
      const answer = await generateText({
        model: resolveModel(agent.chatProvider, agent.chatModelId),
        system: buildSystemPrompt(hits),
        messages,
        stopWhen: stepCountIs(5),
        maxRetries: 1,
      });

      const text = (answer.text || '').trim();
      if (!text) return json(res, 200, { ok: true, detail: 'empty answer' });
      rememberTurn(sessionId, parsed.message.text, text);

      const delivery = await deliverChannelReply(parsed.message.reply, settings, text);
      if (!delivery.ok) {
        emit('channel.delivery_failed', { channelId, runId }, { payload: { error: delivery.error } });
        seenMessages.delete(key);
        return json(res, 502, { ok: false, error: delivery.error });
      }

      emit('channel.delivered', { channelId, runId, sessionId });
      return json(res, 200, { ok: true, reply: text });
    } catch (error) {
      seenMessages.delete(key);
      emit('run.failed', { channelId, runId }, { level: 'error', payload: { error: String(error) } });
      return json(res, 500, { ok: false, error: String(error) });
    }
  }

  /* ---- Browser-facing endpoints are origin-gated. */
  const decision = checkOrigin(req, selfOrigin);
  const cors = corsHeaders(decision);

  if (req.method === 'OPTIONS') {
    res.writeHead(decision.allowed ? 204 : 403, cors);
    return res.end();
  }

  if (!decision.allowed) {
    emit('security.origin_denied', {}, { payload: { origin: decision.origin, reason: decision.reason } });
    return json(res, 403, { error: 'Origin "' + decision.origin + '" is not in this agent\'s allowed-origins list.' }, cors);
  }

  // Requests/minute per visitor (plan §8.5) — checked before auth, same as
  // the dashboard's authorizeAgentRequest, so a caller spamming a wrong join
  // code does not get an unbounded number of guesses.
  const rate = rateConsume('req:' + visitorKey(req), 1, REQUESTS_PER_MINUTE);
  if (!rate.allowed) return rateLimitResponse(res, rate, cors);

  const authError = checkAuth(req);
  if (authError) {
    emit('security.auth_failed', {}, { payload: { reason: authError.error } });
    return json(res, authError.status, { error: authError.error }, cors);
  }

  if (path === '/agent') return json(res, 200, publicConfig(), cors);

  if (path === '/chat') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' }, cors);

    // Messages/session and the daily token ceiling (plan §8.5) — chat-
    // specific, checked here rather than above since only a chat turn has a
    // "message" to count or a run whose usage to charge.
    const vKey = visitorKey(req);
    const messageQuota = rateConsume('msg:' + vKey, 1, MESSAGES_PER_SESSION);
    if (!messageQuota.allowed) return rateLimitResponse(res, messageQuota, cors);

    const dailyCeiling = agent.dailyTokenCeiling;
    if (dailyCeiling) {
      const budget = rateConsume('cost:' + agent.id, 0, dailyBucketConfig(dailyCeiling));
      if (!budget.allowed) return rateLimitResponse(res, budget, cors);
    }

    const runId = randomUUID();
    const startedAt = Date.now();

    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const messages = normalizeMessages(body.messages);
      if (!messages.length) return json(res, 400, { error: 'messages array is required' }, cors);

      emit('run.started', { runId }, { payload: { messageCount: messages.length } });

      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const hits = await retrieve(lastUser ? lastUser.content : '', body.retrievalTopK ?? 5);
      emit('retrieval.completed', { runId }, { payload: { hits: hits.length } });

      const result = streamText({
        model: resolveModel(agent.chatProvider, agent.chatModelId),
        system: buildSystemPrompt(hits),
        messages: messages.filter((m) => m.role !== 'system'),
        stopWhen: stepCountIs(5),
        maxRetries: 0,
        onFinish: (event) => {
          // Charged after the run, not gated by it — the actual cost of a
          // turn is only known once it has already happened.
          if (dailyCeiling && event.totalUsage && event.totalUsage.totalTokens) {
            rateCharge('cost:' + agent.id, event.totalUsage.totalTokens, dailyBucketConfig(dailyCeiling));
          }
          emit('run.completed', { runId }, {
            durationMs: Date.now() - startedAt,
            payload: {
              model: agent.chatModelId,
              provider: agent.chatProvider,
              finishReason: event.finishReason,
              usage: event.totalUsage,
            },
          });
        },
      });

      const response = result.toUIMessageStreamResponse();
      res.writeHead(response.status, { ...Object.fromEntries(response.headers), ...cors });
      for await (const chunk of response.body) res.write(chunk);
      return res.end();
    } catch (error) {
      emit('run.failed', { runId }, { level: 'error', durationMs: Date.now() - startedAt, payload: { error: String(error) } });
      return json(res, 500, { error: String(error) }, cors);
    }
  }

  return json(res, 404, { error: 'Not found' }, cors);
});

server.listen(PORT, () => {
  emit('deployment.succeeded', {}, {
    payload: {
      port: PORT,
      target: TARGET,
      agent: agent.name,
      version: release.version,
      allowedOrigins: agent.allowedOrigins,
    },
  });
  console.log('Larkup Agent Runtime — ' + agent.name + ' v' + release.version + ' on :' + PORT);
});

/** Give in-flight streams a chance to finish before the container dies. */
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  });
}
`;
}
