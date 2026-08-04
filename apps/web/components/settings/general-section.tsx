'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Loader2, Save, Eye, EyeOff, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
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
import { useWorkspace } from '@/components/workspace/workspace-provider';
import {
  useThemeCustomizer,
  type ThemeVariant,
  type LayoutVariant,
} from '@/components/theme-customizer-provider';

const THEMES: { id: ThemeVariant; name: string; color: string; description: string }[] = [
  { id: 'default', name: 'Default', color: '#000000', description: 'Clean & minimal gray palette' },
  {
    id: 'theme-gaia',
    name: 'Larkup',
    color: '#e6d343ff',
    description: 'Warm ivory with dark accents',
  },
];

const LAYOUTS: { id: LayoutVariant; name: string; description: string }[] = [
  { id: 'sidebar', name: 'Sidebar Navigation', description: 'Classic left sidebar layout' },
  { id: 'topnav', name: 'Top Navigation', description: 'Horizontal navigation bar' },
];

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

export function GeneralSection() {
  const { data, isLoading, mutate } = useSWR('/api/config', fetcher);
  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const { username, setUsername } = useWorkspace();
  const { theme, setTheme, layout, setLayout, isMounted } = useThemeCustomizer();
  const [localName, setLocalName] = useState(username || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showProxyPassword, setShowProxyPassword] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<{
    status: 'success' | 'error' | null;
    message?: string;
  }>({ status: null });

  const [persistedTheme, setPersistedTheme] = useState<string | null>(null);
  const [persistedLayout, setPersistedLayout] = useState<string | null>(null);

  useEffect(() => {
    if (isMounted) {
      setPersistedTheme(localStorage.getItem('app-theme') || 'default');
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

  async function handleVerify() {
    if (!form.webSearchProvider) return;
    setVerifying(true);
    setVerifyStatus({ status: null });

    let apiKey = '';
    if (form.webSearchProvider === 'serper' || form.webSearchProvider === 'google')
      apiKey = form.serperApiKey || '';
    if (form.webSearchProvider === 'tavily') apiKey = form.tavilyApiKey || '';
    if (form.webSearchProvider === 'brave') apiKey = form.braveApiKey || '';
    if (form.webSearchProvider === 'bing') apiKey = form.bingApiKey || '';
    if (form.webSearchProvider === 'exa') apiKey = form.exaApiKey || '';

    try {
      const res = await fetch('/api/search/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: form.webSearchProvider, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');

      setVerifyStatus({ status: 'success' });
      toast.success('API Key verified successfully!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      setVerifyStatus({ status: 'error', message: msg });
      toast.error(msg);
    } finally {
      setVerifying(false);
    }
  }

  const [verifyingCrawler, setVerifyingCrawler] = useState(false);
  const [verifyCrawlerStatus, setVerifyCrawlerStatus] = useState<{
    status: 'success' | 'error' | null;
    message?: string;
  }>({ status: null });

  async function handleVerifyCrawler() {
    if (form.webCrawlerProvider !== 'cloud') return;
    setVerifyingCrawler(true);
    setVerifyCrawlerStatus({ status: null });

    try {
      const res = await fetch('/api/search/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'firecrawl', apiKey: form.firecrawlApiKey || '' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');

      setVerifyCrawlerStatus({ status: 'success' });
      toast.success('Crawler API Key verified successfully!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      setVerifyCrawlerStatus({ status: 'error', message: msg });
      toast.error(msg);
    } finally {
      setVerifyingCrawler(false);
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
          <p className="text-sm text-muted-foreground">Workspace and integration settings.</p>
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
            size="sm"
            disabled={saving === 'username' || !dirtyUsername}
            onClick={() => handleSave('username')}
            className="gap-1.5"
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
                  <SelectValue placeholder="Select theme" />
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
                  <SelectValue placeholder="Select layout" />
                </SelectTrigger>
                <SelectContent>
                  {LAYOUTS.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end pt-4 border-t">
            <Button
              size="sm"
              disabled={!dirtyAppearance}
              onClick={handleSaveAppearance}
              className="gap-1.5"
            >
              <Save className="size-3.5" />
              Save
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
