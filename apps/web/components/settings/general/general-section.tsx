'use client';
import { GeneralSettingsView } from '@larkup/workspace-ui/general-settings-view';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { RagConfig } from '@larkup/core/types';
import { DEFAULT_THEME, useThemeCustomizer } from '@/components/theme-customizer-provider';
import { CacheManagementCard } from './cache-management-card';

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
    <GeneralSettingsView
      localName={localName}
      setLocalName={setLocalName}
      saving={saving}
      dirtyUsername={dirtyUsername}
      handleSave={handleSave}
      theme={theme}
      setTheme={setTheme}
      layout={layout}
      setLayout={setLayout}
      isMounted={isMounted}
      dirtyAppearance={dirtyAppearance}
      handleSaveAppearance={handleSaveAppearance}
      cache={<CacheManagementCard />}
    />
  );
}
