import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Small, dependency-free crawler used by the desktop, CLI, and curl install.
 * It deliberately does not require Docker, a browser binary, or a cloud key.
 * JavaScript-only and bot-protected sites can still use Firecrawl Cloud.
 */
const DATA_DIR = path.join(process.cwd(), '.larkup');
const STATE_PATH = path.join(DATA_DIR, 'native-crawls.json');
const USER_AGENT = 'LarkupCrawler/1.0 (+https://larkup.de)';
const MAX_HTML_BYTES = 2_000_000;

export interface NativePage {
  url: string;
  title: string;
  markdown: string;
  /** Internal domain-crawl frontier; callers only consume the public fields. */
  links?: string[];
}

interface NativeCrawl {
  id: string;
  origin: string;
  limit: number;
  queue: string[];
  visited: string[];
  pages: NativePage[];
  delivered: number;
  cancelled?: boolean;
}

async function readCrawls(): Promise<Record<string, NativeCrawl>> {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, 'utf8')) as Record<string, NativeCrawl>;
  } catch {
    return {};
  }
}

async function writeCrawls(crawls: Record<string, NativeCrawl>) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(crawls, null, 2), 'utf8');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, code) => {
      const numeric = String(code).toLowerCase().startsWith('x')
        ? parseInt(String(code).slice(1), 16)
        : parseInt(String(code), 10);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : '';
    });
}

function toText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

function pageTitle(html: string, fallback: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1].replace(/<[^>]+>/g, ' ').trim()) || fallback : fallback;
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function linksFromHtml(html: string, baseUrl: string, origin: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/<a\s[^>]*?href\s*=\s*["']([^"'#]+)["']/gi)) {
    const resolved = canonicalUrl(new URL(match[1], baseUrl).toString());
    if (resolved && new URL(resolved).origin === origin) links.add(resolved);
  }
  return [...links];
}

export async function nativeScrapePage(url: string): Promise<NativePage> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Website returned ${response.status} ${response.statusText}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`Unsupported page type: ${contentType || 'unknown'}`);
  }
  const html = (await response.text()).slice(0, MAX_HTML_BYTES);
  const finalUrl = canonicalUrl(response.url) ?? url;
  const markdown = toText(html);
  if (!markdown) throw new Error('The page did not contain readable HTML text.');
  return {
    url: finalUrl,
    title: pageTitle(html, finalUrl),
    markdown,
    links: linksFromHtml(html, finalUrl, new URL(finalUrl).origin),
  };
}

export async function startNativeCrawl(url: string, limit: number): Promise<string> {
  const startUrl = canonicalUrl(url);
  if (!startUrl) throw new Error('A valid http or https URL is required.');
  const id = `native-${randomUUID()}`;
  const crawls = await readCrawls();
  crawls[id] = {
    id,
    origin: new URL(startUrl).origin,
    limit: Math.max(1, limit),
    queue: [startUrl],
    visited: [],
    pages: [],
    delivered: 0,
  };
  await writeCrawls(crawls);
  return id;
}

export async function getNativeCrawlStatus(id: string): Promise<{
  state: 'scraping' | 'completed' | 'failed' | 'cancelled';
  total: number;
  completed: number;
  pages: NativePage[];
}> {
  const crawls = await readCrawls();
  const crawl = crawls[id];
  if (!crawl) throw new Error('Native crawl was not found.');
  if (crawl.cancelled) {
    return { state: 'cancelled', total: crawl.limit, completed: crawl.pages.length, pages: [] };
  }

  // Two pages per poll keeps the UI responsive while avoiding a long request.
  for (
    let count = 0;
    count < 2 && crawl.queue.length && crawl.pages.length < crawl.limit;
    count++
  ) {
    const next = crawl.queue.shift()!;
    if (crawl.visited.includes(next)) continue;
    crawl.visited.push(next);
    try {
      const page = await nativeScrapePage(next);
      crawl.pages.push(page);
      for (const link of page.links ?? []) {
        if (new URL(link).origin !== crawl.origin) continue;
        if (!crawl.visited.includes(link) && !crawl.queue.includes(link)) crawl.queue.push(link);
      }
    } catch {
      // A single inaccessible page must not abort a whole domain crawl.
    }
  }

  const newPages = crawl.pages.slice(crawl.delivered).map(({ links: _links, ...page }) => page);
  crawl.delivered = crawl.pages.length;
  const finished = !crawl.queue.length || crawl.pages.length >= crawl.limit;
  await writeCrawls(crawls);
  return {
    state: finished ? 'completed' : 'scraping',
    total: crawl.limit,
    completed: crawl.pages.length,
    pages: newPages,
  };
}

export async function cancelNativeCrawl(id: string): Promise<void> {
  const crawls = await readCrawls();
  if (!crawls[id]) return;
  crawls[id].cancelled = true;
  await writeCrawls(crawls);
}
