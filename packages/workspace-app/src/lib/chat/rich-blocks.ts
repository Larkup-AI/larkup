/**
 * Rich answer blocks are fenced Markdown blocks whose language names a
 * renderable visual (metrics, mermaid, math, tabs, chart). They let
 * an assistant answer use compact visual elements while the persisted message
 * remains plain Markdown text. Unknown languages stay ordinary code blocks.
 */
import { normalizeChartConfig, type ChartConfig } from './chart-config';

export type RichBlockKind = 'metrics' | 'mermaid' | 'math' | 'tabs' | 'chart';

export interface MetricItem {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  variant?: 'neutral' | 'highlight' | 'positive' | 'negative';
}

export interface MetricsBlock {
  title?: string;
  items: MetricItem[];
  highlight?: MetricItem;
}

export interface TabsBlock {
  tabs: Array<{ label: string; content: string }>;
}

export type RichSegment =
  | { type: 'markdown'; content: string }
  | { type: 'metrics'; block: MetricsBlock }
  | { type: 'mermaid'; code: string }
  | { type: 'math'; tex: string }
  | { type: 'tabs'; block: TabsBlock }
  | { type: 'chart'; config: ChartConfig }
  /** An opening fence that is still streaming; never show its raw payload. */
  | { type: 'pending'; kind: RichBlockKind };

const LANGUAGE_KINDS: Record<string, RichBlockKind> = {
  metrics: 'metrics',
  stats: 'metrics',
  'larkup-metrics': 'metrics',
  mermaid: 'mermaid',
  diagram: 'mermaid',
  math: 'math',
  latex: 'math',
  tex: 'math',
  katex: 'math',
  tabs: 'tabs',
  'larkup-tabs': 'tabs',
  chart: 'chart',
  'larkup-chart': 'chart',
};

const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w-]*)[^\n]*$/;

function richKind(language: string): RichBlockKind | undefined {
  return LANGUAGE_KINDS[language.trim().toLowerCase()];
}

function cleanString(value: unknown, max = 160): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

function parseMetricItem(value: unknown): MetricItem | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const label = cleanString(item.label ?? item.name);
  const metric = cleanString(item.value);
  if (!label || !metric) return undefined;
  const unit = cleanString(item.unit, 32);
  const note = cleanString(item.note ?? item.detail ?? item.description, 200);
  const variant =
    item.variant === 'highlight' || item.variant === 'positive' || item.variant === 'negative'
      ? item.variant
      : 'neutral';
  return { label, value: metric, ...(unit ? { unit } : {}), ...(note ? { note } : {}), variant };
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

export function parseMetricsBlock(source: string): MetricsBlock | undefined {
  const raw = parseJson(source);
  const record = Array.isArray(raw) ? { items: raw } : raw;
  if (!record || typeof record !== 'object') return undefined;
  const value = record as Record<string, unknown>;
  const items = (Array.isArray(value.items) ? value.items : [])
    .map(parseMetricItem)
    .filter((item): item is MetricItem => Boolean(item))
    .slice(0, 8);
  const highlight = parseMetricItem(value.highlight);
  if (items.length === 0 && !highlight) return undefined;
  const title = cleanString(value.title);
  return { ...(title ? { title } : {}), items, ...(highlight ? { highlight } : {}) };
}

export function parseTabsBlock(source: string): TabsBlock | undefined {
  const raw = parseJson(source);
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { tabs?: unknown }).tabs)
      ? (raw as { tabs: unknown[] }).tabs
      : [];
  const tabs = list
    .map((tab) => {
      if (!tab || typeof tab !== 'object') return undefined;
      const record = tab as Record<string, unknown>;
      const label = cleanString(record.label ?? record.title, 60);
      const content = typeof record.content === 'string' ? record.content.trim() : '';
      return label && content ? { label, content } : undefined;
    })
    .filter((tab): tab is { label: string; content: string } => Boolean(tab))
    .slice(0, 6);
  return tabs.length > 0 ? { tabs } : undefined;
}

function parseChartBlock(source: string): ChartConfig | undefined {
  const raw = parseJson(source);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const config = normalizeChartConfig(raw);
  return config.data.length > 0 && config.series.length > 0 && !config.error ? config : undefined;
}

function blockSegment(kind: RichBlockKind, body: string): RichSegment | undefined {
  switch (kind) {
    case 'metrics': {
      const block = parseMetricsBlock(body);
      return block ? { type: 'metrics', block } : undefined;
    }
    case 'tabs': {
      const block = parseTabsBlock(body);
      return block ? { type: 'tabs', block } : undefined;
    }
    case 'chart': {
      const config = parseChartBlock(body);
      return config ? { type: 'chart', config } : undefined;
    }
    case 'mermaid':
      return body.trim() ? { type: 'mermaid', code: body.trim() } : undefined;
    case 'math':
      return body.trim() ? { type: 'math', tex: body.trim() } : undefined;
  }
}

/**
 * Splits assistant Markdown into ordinary Markdown and rich visual blocks.
 * Invalid rich payloads fall back to their original fenced Markdown so no
 * answer content is ever silently discarded.
 */
export function splitRichSegments(text: string): RichSegment[] {
  if (!text) return [];
  const lines = text.split('\n');
  const segments: RichSegment[] = [];
  let markdown: string[] = [];

  const flushMarkdown = () => {
    const content = markdown.join('\n');
    if (content.trim()) segments.push({ type: 'markdown', content });
    markdown = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const open = lines[index].match(OPEN_FENCE);
    if (!open) {
      markdown.push(lines[index]);
      continue;
    }
    const fence = open[1];
    const kind = richKind(open[2] ?? '');
    let close = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor].trim();
      if (candidate.startsWith(fence) && /^(`+|~+)$/.test(candidate)) {
        close = cursor;
        break;
      }
    }

    if (!kind) {
      const end = close === -1 ? lines.length - 1 : close;
      markdown.push(...lines.slice(index, end + 1));
      index = end;
      continue;
    }

    if (close === -1) {
      flushMarkdown();
      segments.push({ type: 'pending', kind });
      return segments;
    }

    const body = lines.slice(index + 1, close).join('\n');
    const segment = blockSegment(kind, body);
    if (segment) {
      flushMarkdown();
      segments.push(segment);
    } else {
      markdown.push(...lines.slice(index, close + 1));
    }
    index = close;
  }

  flushMarkdown();
  return segments;
}

function metricText(item: MetricItem) {
  return `${item.label}: ${item.value}${item.unit ? ' ' + item.unit : ''}`;
}

/**
 * Plain-text form used for clipboard copies and conversation memory.
 * Visual payload syntax is replaced by the facts it presents, so history
 * and clipboard copies remain clean text without HTML/JSON wrappers.
 */
export function richBlocksToPlainText(text: string): string {
  return splitRichSegments(text)
    .map((segment) => {
      switch (segment.type) {
        case 'markdown':
          return segment.content.trim();
        case 'metrics': {
          const rows = [
            ...segment.block.items,
            ...(segment.block.highlight ? [segment.block.highlight] : []),
          ];
          return [segment.block.title, ...rows.map((row) => `- ${metricText(row)}`)]
            .filter(Boolean)
            .join('\n');
        }
        case 'math':
          return `$$${segment.tex}$$`;
        case 'mermaid':
          return '```mermaid\n' + segment.code + '\n```';
        case 'tabs':
          return segment.block.tabs.map((tab) => `${tab.label}\n${tab.content}`).join('\n\n');
        case 'chart':
          return segment.config.title ? `[Chart: ${segment.config.title}]` : '';
        case 'pending':
          return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

const IMAGE_URL_KEYS = new Set(['imageUrl', 'previewUrl', 'url', 'image']);

export function isSafeImageUrl(url: string | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (trimmed.startsWith('data:image/')) return true;
  return false;
}

/**
 * Collects image URLs returned by this message own tool results.
 */
export function collectToolImageUrls(values: unknown[]): Set<string> {
  const urls = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          visit(JSON.parse(trimmed), depth + 1);
        } catch {}
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 200)) visit(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (IMAGE_URL_KEYS.has(key) && typeof child === 'string' && isSafeImageUrl(child)) {
        urls.add(child.trim());
      } else if (child && typeof child === 'object') {
        visit(child, depth + 1);
      }
    }
  };
  for (const value of values) visit(value, 0);
  return urls;
}
