'use client';

import { useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import {
  Download,
  Trash2,
  Check,
  Loader2,
  ExternalLink,
  Search,
  type LucideIcon,
  Film,
  ScanEye,
  CircleIcon,
  Megaphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Input } from '../ui/input';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface MarketplaceTool {
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  category: string;
  version: string;
  pricing: 'free' | 'pro' | 'enterprise';
  installSize: string;
  systemDeps?: string[];
  emoji?: string;
  iconUrl?: string;
  icon: string;
  author: string;
  capabilities: string[];
  tags?: string[];
  downloads: number;
  repositoryUrl?: string;
  license?: string;
  updatedAt?: string;
  status: 'available' | 'installed' | 'installing' | 'error';
  comingSoon?: boolean;
  installedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Icon resolver                                                       */
/* ------------------------------------------------------------------ */

const ICON_MAP: Record<string, LucideIcon> = {
  Film,
  ScanEye,
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatDownloads(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  media: 'Media',
  search: 'Search',
  analytics: 'Analytics',
  integration: 'Integration',
  embedding: 'Embedding',
  ai: 'AI',
  automation: 'Automation',
  utility: 'Utility',
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<{ tools: MarketplaceTool[] }>);

export function MarketplaceSection() {
  const { data, isLoading, mutate } = useSWR('/api/marketplace', fetcher);
  const [installing, setInstalling] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const handleInstall = useCallback(
    async (toolId: string) => {
      setInstalling(toolId);
      try {
        const res = await fetch(`/api/marketplace/${toolId}`, {
          method: 'POST',
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Install failed');
        }
        toast.success('Tool installed successfully');
        mutate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to install tool');
      } finally {
        setInstalling(null);
      }
    },
    [mutate],
  );

  const handleUninstall = useCallback(
    async (toolId: string) => {
      try {
        const res = await fetch(`/api/marketplace/${toolId}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error('Uninstall failed');
        toast.success('Tool removed');
        mutate();
      } catch {
        toast.error('Failed to remove tool');
      }
    },
    [mutate],
  );

  const tools = data?.tools ?? [];

  // Derive available categories from tools
  const categories = useMemo(() => {
    const cats = new Set(tools.map((t) => t.category));
    return ['all', ...Array.from(cats).sort()];
  }, [tools]);

  // Filter tools
  const filteredTools = useMemo(() => {
    let result = tools;

    if (activeCategory !== 'all') {
      result = result.filter((t) => t.category === activeCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags?.some((tag) => tag.toLowerCase().includes(q)) ||
          t.author.toLowerCase().includes(q),
      );
    }

    return result;
  }, [tools, activeCategory, searchQuery]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground">Marketplace</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Extend Larkup with optional tools and capabilities.
        </p>
      </div>

      {/* Search + Category filters */}
      <div className="flex flex-col gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search tools…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              'w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2',
              'text-[13px] text-foreground placeholder:text-muted-foreground/50',
              'outline-none transition-colors',
              'focus:border-foreground/20',
            )}
          />
        </div>

        {/* Category pills */}
        {categories.length > 2 && (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  'shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                  activeCategory === cat
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                {CATEGORY_LABELS[cat] ?? cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tools list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : filteredTools.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {searchQuery || activeCategory !== 'all'
            ? 'No tools match your search.'
            : 'No tools available yet.'}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredTools.map((tool) => (
            <ToolRow
              key={tool.id}
              tool={tool}
              installing={installing === tool.id}
              onInstall={handleInstall}
              onUninstall={handleUninstall}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tool row (one per row layout)                                       */
/* ------------------------------------------------------------------ */

function ToolRow({
  tool,
  installing,
  onInstall,
  onUninstall,
}: {
  tool: MarketplaceTool;
  installing: boolean;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
}) {
  const Icon = ICON_MAP[tool.icon] ?? Film;
  const isInstalled = tool.status === 'installed';
  const isComingSoon = tool.comingSoon;

  return (
    <div
      className={cn(
        'group flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3.5',
        'transition-colors hover:border-border/80',
      )}
    >
      {/* Icon */}
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/50 border">
        {tool.emoji ? (
          <span className="text-xl leading-none">{tool.emoji}</span>
        ) : (
          <Icon className="size-5 text-foreground" strokeWidth={1.75} />
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-medium text-foreground truncate">{tool.name}</h3>
          <span className="shrink-0 text-[11px] text-muted-foreground/60">v{tool.version}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground/40">·</span>
          <span className="shrink-0 text-[11px] text-muted-foreground/60">{tool.author}</span>
        </div>

        <p className="mt-0.5 text-[12px] text-muted-foreground leading-relaxed line-clamp-1">
          {tool.description}
        </p>

        {/* Tags */}
        {tool.tags && tool.tags.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1 overflow-hidden">
            {tool.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {tool.tags.length > 4 && (
              <span className="text-[10px] text-muted-foreground/50">+{tool.tags.length - 4}</span>
            )}
          </div>
        )}
      </div>

      {/* Meta column */}
      <div className="hidden sm:flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground/60">
        <span className="tabular-nums">{tool.installSize}</span>
        {tool.downloads > 0 && (
          <span className="tabular-nums">↓ {formatDownloads(tool.downloads)}</span>
        )}
      </div>

      {/* Pricing badge */}
      <div className="shrink-0">
        <span
          className={cn(
            'rounded-md px-2 py-0.5 text-[10px] font-medium',
            tool.pricing === 'free'
              ? 'bg-secondary text-muted-foreground'
              : tool.pricing === 'pro'
              ? 'bg-blue-50 text-blue-600'
              : 'bg-purple-50 text-purple-600',
          )}
        >
          {tool.pricing === 'free' ? 'Free' : tool.pricing === 'pro' ? 'Pro' : 'Enterprise'}
        </span>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-1.5">
        {tool.repositoryUrl && (
          <a
            href={tool.repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-md text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}

        {isComingSoon ? (
          <Button size="sm" className={'h-7 text-[11px]'} variant={'default'} disabled>
            <Megaphone className="size-3" />
            Soon
          </Button>
        ) : isInstalled ? (
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <Check className="size-3" />
              Installed
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0 text-muted-foreground/40 hover:text-destructive"
              onClick={() => onUninstall(tool.id)}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        ) : (
          <Button
            variant="default"
            size="sm"
            className="h-7 gap-1.5 text-[11px] px-3"
            disabled={installing}
            onClick={() => onInstall(tool.id)}
          >
            {installing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Download className="size-3" />
            )}
            {installing ? 'Installing…' : 'Install'}
          </Button>
        )}
      </div>
    </div>
  );
}
