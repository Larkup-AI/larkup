'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Loader2, Save, PanelLeft, PanelTop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { RagConfig } from '@larkup/core/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import {
  DEFAULT_THEME,
  useThemeCustomizer,
  type ThemeVariant,
  type LayoutVariant,
} from '@/components/theme-customizer-provider';
import { CacheManagementCard } from './cache-management-card';

const THEMES: { id: ThemeVariant; name: string; color: string; description: string }[] = [
  {
    id: 'theme-gaia',
    name: 'Warm Ivory',
    color: '#e6d343ff',
    description: 'Warm ivory with dark accents',
  },
  {
    id: 'default',
    name: 'Minimalist Gray',
    color: '#636262ff',
    description: 'Clean & minimal gray palette',
  },
  {
    id: 'theme-linear',
    name: 'Crisp White',
    color: '#c7c6c6ff',
    description: 'Crisp white with soft gray navigation',
  },
];

const LAYOUTS: {
  id: LayoutVariant;
  name: string;
  description: string;
  icon: React.ElementType;
  color: string;
}[] = [
  {
    id: 'sidebar',
    name: 'Sidebar Navigation',
    description: 'Classic left sidebar layout',
    icon: PanelLeft,
    color: 'text-blue-500',
  },
  {
    id: 'topnav',
    name: 'Top Navigation',
    description: 'Horizontal navigation bar',
    icon: PanelTop,
    color: 'text-emerald-500',
  },
];

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

export function GeneralSection() {
  const { data, isLoading, mutate } = useSWR('/api/config', fetcher);
  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const username = '';
  const setUsername = async (_name: string) => undefined;
  const { theme, setTheme, layout, setLayout, isMounted } = useThemeCustomizer();
  const [localName, setLocalName] = useState(username || '');

  const [persistedTheme, setPersistedTheme] = useState<string | null>(null);
  const [persistedLayout, setPersistedLayout] = useState<string | null>(null);

  useEffect(() => {
    if (isMounted) {
      setPersistedTheme(localStorage.getItem('app-theme') || DEFAULT_THEME);
      setPersistedLayout(localStorage.getItem('app-layout') || 'sidebar');
    }
  }, [isMounted]);

  const dirtyAppearance =
    persistedTheme !== null &&
    persistedLayout !== null &&
    (theme !== persistedTheme || layout !== persistedLayout);

  const handleSaveAppearance = () => {
    setTheme(theme, true);
    setLayout(layout, true);
    setPersistedTheme(theme);
    setPersistedLayout(layout);
    toast.success('Appearance settings saved');
  };

  useEffect(() => {
    if (data?.config) setForm(data.config);
  }, [data]);

  useEffect(() => {
    if (username && localName !== username) setLocalName(username);
  }, [username]);

  const dirtyUsername = localName.trim() !== (username || '');
  const dirtyWebSearch =
    form.serperApiKey !== data?.config?.serperApiKey ||
    form.webSearchProvider !== data?.config?.webSearchProvider ||
    form.tavilyApiKey !== data?.config?.tavilyApiKey ||
    form.googleApiKey !== data?.config?.googleApiKey ||
    form.braveApiKey !== data?.config?.braveApiKey ||
    form.bingApiKey !== data?.config?.bingApiKey ||
    form.exaApiKey !== data?.config?.exaApiKey;
  const dirtyWebCrawler =
    form.webCrawlerProvider !== data?.config?.webCrawlerProvider ||
    form.firecrawlApiKey !== data?.config?.firecrawlApiKey;
  const dirtyProxy =
    form.scraperProxyServer !== data?.config?.scraperProxyServer ||
    form.scraperProxyUsername !== data?.config?.scraperProxyUsername ||
    form.scraperProxyPassword !== data?.config?.scraperProxyPassword ||
    form.useScraperProxy !== data?.config?.useScraperProxy;

  async function handleSave(section: 'username' | 'webSearch' | 'webCrawler' | 'proxy') {
    setSaving(section);
    try {
      let payload = { ...data?.config };

      if (section === 'username') {
        if (localName.trim() && localName.trim() !== username) {
          await setUsername(localName.trim());
        }
        setSaving(null);
        toast.success('Settings saved');
        return;
      } else if (section === 'webSearch') {
        payload.serperApiKey = form.serperApiKey;
        payload.webSearchProvider = form.webSearchProvider;
        payload.tavilyApiKey = form.tavilyApiKey;
        payload.googleApiKey = form.googleApiKey;
        payload.braveApiKey = form.braveApiKey;
        payload.bingApiKey = form.bingApiKey;
        payload.exaApiKey = form.exaApiKey;
      } else if (section === 'webCrawler') {
        payload.webCrawlerProvider = form.webCrawlerProvider;
        payload.firecrawlApiKey = form.firecrawlApiKey;
      } else if (section === 'proxy') {
        payload.scraperProxyServer = form.scraperProxyServer;
        payload.scraperProxyUsername = form.scraperProxyUsername;
        payload.scraperProxyPassword = form.scraperProxyPassword;
        payload.useScraperProxy = form.useScraperProxy;
      }

      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save');

      setForm((prev) => ({ ...prev, ...json.config }));
      await mutate(json, { revalidate: false });
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">General</h2>
          <p className="text-sm text-muted-foreground">Project settings and preferences.</p>
        </div>
      </div>

      {/* Username */}
      <Card id="web-crawler" className="">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Your Name</CardTitle>
          <CardDescription className="text-xs">Displayed in the workspace header.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder="Enter your name"
            className=""
          />
        </CardContent>
        <CardFooter className="flex justify-end pt-4 border-t">
          <Button
            size="lg"
            disabled={saving === 'username' || !dirtyUsername}
            onClick={() => handleSave('username')}
            className="gap-1.5 px-4"
          >
            {saving === 'username' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </CardFooter>
      </Card>

      {/* Appearance */}
      {isMounted && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Appearance</CardTitle>
            <CardDescription className="text-xs">
              Customize the theme and layout of your workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label className="text-xs">Theme</Label>
              <Select value={theme} onValueChange={(val) => setTheme(val as ThemeVariant, false)}>
                <SelectTrigger className="w-full text-sm">
                  {THEMES.find((t) => t.id === theme) ? (
                    <div className="flex items-center gap-2 flex-1 text-left">
                      <div
                        className="h-3 w-3 rounded-full border border-border/50"
                        style={{ background: THEMES.find((t) => t.id === theme)?.color }}
                      />
                      <span>{THEMES.find((t) => t.id === theme)?.name}</span>
                    </div>
                  ) : (
                    <SelectValue placeholder="Select theme" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  {THEMES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full border border-border/50"
                          style={{ background: t.color }}
                        />
                        <span>{t.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label className="text-xs">Navigation Style</Label>
              <Select
                value={layout}
                onValueChange={(val) => setLayout(val as LayoutVariant, false)}
              >
                <SelectTrigger className="w-full text-sm">
                  {LAYOUTS.find((l) => l.id === layout) ? (
                    <div className="flex items-center gap-2 flex-1 text-left">
                      {(() => {
                        const l = LAYOUTS.find((l) => l.id === layout)!;
                        const Icon = l.icon;
                        return (
                          <>
                            <Icon className={`size-4 ${l.color}`} />
                            <span>{l.name}</span>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <SelectValue placeholder="Select layout" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  {LAYOUTS.map((l) => {
                    const Icon = l.icon;
                    return (
                      <SelectItem key={l.id} value={l.id}>
                        <div className="flex items-center gap-2">
                          <Icon className={`size-4 ${l.color}`} />
                          <span>{l.name}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end pt-4 border-t">
            <Button
              size="lg"
              disabled={!dirtyAppearance}
              onClick={handleSaveAppearance}
              className="gap-1.5 px-4"
            >
              <Save className="size-3.5" />
              Save
            </Button>
          </CardFooter>
        </Card>
      )}

      <CacheManagementCard />
    </div>
  );
}
