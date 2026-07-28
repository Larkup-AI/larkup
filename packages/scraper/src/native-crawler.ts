import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Small, dependency-free crawler used by the desktop, CLI, and curl install.
 * It deliberately does not require Docker, a browser binary, or a cloud key.
 * JavaScript-only and bot-protected sites can still use Firecrawl Cloud.
 */
const DATA_DIR = path.join(process.cwd(), '.larkup');
const CRAWLS_DIR = path.join(DATA_DIR, 'native-crawls');
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

export interface NativeSearchResult {
  url: string;
  title: string;
  description?: string;
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

function crawlPath(id: string) {
  return path.join(CRAWLS_DIR, `${id}.json`);
}

/**
 * Persist each crawl separately. The old single JSON file made two jobs that
 * started at the same time race to overwrite one another, leaving the UI with
 * a valid job id but no crawl state to poll.
 */
async function readCrawl(id: string): Promise<NativeCrawl | undefined> {
  try {
    return JSON.parse(await fs.readFile(crawlPath(id), 'utf8')) as NativeCrawl;
  } catch {
    // Keep already-started crawls from older releases usable after upgrading.
    return (await readCrawls())[id];
  }
}

async function writeCrawl(crawl: NativeCrawl): Promise<void> {
  await fs.mkdir(CRAWLS_DIR, { recursive: true });
  await fs.writeFile(crawlPath(crawl.id), JSON.stringify(crawl, null, 2), 'utf8');
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

function htmlText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function nativeSearchUrl(value: string): string | null {
  try {
    const url = new URL(decodeHtml(value));
    return canonicalUrl(url.searchParams.get('uddg') || url.toString());
  } catch {
    return null;
  }
}

/**
 * API-key-free public web search for the native crawler. It intentionally
 * lives next to the crawler instead of pretending that `native://` is a
 * Firecrawl HTTP endpoint. This keeps curl installs fully usable without
 * Docker or a separate search-service account.
 */
export async function nativeSearchWeb(query: string, limit = 10): Promise<NativeSearchResult[]> {
  const resultLimit = Math.max(1, Math.min(limit, 25));
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // Keep the native path independent of a cloud key. Public search pages can
  // occasionally rate-limit a shared IP, so use a second source instead of
  // turning a temporary upstream limit into a misleading "Network error".
  try {
    const response = await fetch(
      `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`,
      { headers, redirect: 'follow', signal: AbortSignal.timeout(20_000) },
    );
    if (response.ok) {
      const results = parseBraveSearchResults(await response.text(), resultLimit);
      if (results.length) return results;
    }
  } catch {
    // Continue to the fallback below.
  }

  const fallback = await fetch(
    `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`,
    {
      headers: { ...headers, Accept: 'application/rss+xml,application/xml,text/xml' },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!fallback.ok) throw new Error(`Built-in web search returned ${fallback.status}.`);
  const results = parseBingRssResults(await fallback.text(), resultLimit);
  if (!results.length) throw new Error('Built-in web search returned no usable results.');
  return results;
}

function parseBraveSearchResults(html: string, limit: number): NativeSearchResult[] {
  const results: NativeSearchResult[] = [];
  const seen = new Set<string>();
  // Brave's server-rendered result anchors are intentionally simple and do
  // not require a browser, JavaScript runtime, Docker, or an API key.
  for (const link of html.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\bl1\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const url = nativeSearchUrl(link[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const titleAttribute = link[2].match(/\btitle=["']([^"']+)["']/i);
    results.push({ url, title: htmlText(titleAttribute?.[1] || link[2]) || url });
    if (results.length >= limit) break;
  }
  return results;
}

function xmlTag(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1];
}

function parseBingRssResults(xml: string, limit: number): NativeSearchResult[] {
  const results: NativeSearchResult[] = [];
  const seen = new Set<string>();
  for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const url = nativeSearchUrl(xmlTag(item[1], 'link') ?? '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({
      url,
      title: htmlText(xmlTag(item[1], 'title') ?? url),
      description: htmlText(xmlTag(item[1], 'description') ?? '') || undefined,
    });
    if (results.length >= limit) break;
  }
  return results;
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
  await writeCrawl({
    id,
    origin: new URL(startUrl).origin,
    limit: Math.max(1, limit),
    queue: [startUrl],
    visited: [],
    pages: [],
    delivered: 0,
  });
  return id;
}

export async function getNativeCrawlStatus(id: string): Promise<{
  state: 'scraping' | 'completed' | 'failed' | 'cancelled';
  total: number;
  completed: number;
  pages: NativePage[];
}> {
  const crawl = await readCrawl(id);
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
  await writeCrawl(crawl);
  return {
    state: finished ? 'completed' : 'scraping',
    total: crawl.limit,
    completed: crawl.pages.length,
    pages: newPages,
  };
}

export async function cancelNativeCrawl(id: string): Promise<void> {
  const crawl = await readCrawl(id);
  if (!crawl) return;
  crawl.cancelled = true;
  await writeCrawl(crawl);
}
