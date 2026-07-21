'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Loader2, Save, Eye, EyeOff } from 'lucide-react';
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
import { useWorkspace } from '@/components/workspace/workspace-provider';
import Image from 'next/image';

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

export function GeneralSection() {
  const { data, isLoading, mutate } = useSWR('/api/config', fetcher);
  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const { username, setUsername } = useWorkspace();
  const [localName, setLocalName] = useState(username || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<{
    status: 'success' | 'error' | null;
    message?: string;
  }>({ status: null });

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
    form.bingApiKey !== data?.config?.bingApiKey;
  const dirtyScraper =
    form.scraperProxyServer !== data?.config?.scraperProxyServer ||
    form.scraperProxyUsername !== data?.config?.scraperProxyUsername ||
    form.scraperProxyPassword !== data?.config?.scraperProxyPassword ||
    form.firecrawlApiKey !== data?.config?.firecrawlApiKey;
  async function handleSave(section: 'username' | 'webSearch' | 'scraper') {
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
      } else if (section === 'scraper') {
        payload.scraperProxyServer = form.scraperProxyServer;
        payload.scraperProxyUsername = form.scraperProxyUsername;
        payload.scraperProxyPassword = form.scraperProxyPassword;
        payload.firecrawlApiKey = form.firecrawlApiKey;
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
      <Card className="">
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

      {/* Web Search */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Web Search</CardTitle>
          <CardDescription className="text-xs">
            Enable AI-powered web search for enriched answers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Web Search Provider</Label>
            <Select
              value={form.webSearchProvider || 'tavily'}
              onValueChange={(value) => {
                setForm({ ...form, webSearchProvider: value as any });
                setVerifyStatus({ status: null });
              }}
            >
              <SelectTrigger className=" w-full">
                <div className="flex items-center gap-2">
                  {/* {form.webSearchProvider === 'google' && <Image src="/icons/google.png" alt="Google" width={16} height={16} />} */}
                  {form.webSearchProvider === 'serper' && (
                    <Image src="/icons/serper.png" alt="Serper" width={16} height={16} />
                  )}
                  {form.webSearchProvider === 'tavily' && (
                    <Image src="/icons/tavily.png" alt="Tavily" width={16} height={16} />
                  )}
                  {form.webSearchProvider === 'brave' && (
                    <Image src="/icons/brave.png" alt="Brave" width={16} height={16} />
                  )}
                  {form.webSearchProvider === 'bing' && (
                    <Image src="/icons/serpapi.svg" alt="SerpApi" width={16} height={16} />
                  )}
                  <SelectValue placeholder="Select provider" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {/* <SelectItem value="google">
                  <div className="flex items-center gap-2">
                    <Image src="/icons/google.png" alt="Google" width={16} height={16} />
                    <span>Google (via Serper)</span>
                  </div>
                </SelectItem> */}
                <SelectItem value="serper">
                  <div className="flex items-center gap-2">
                    <Image src="/icons/serper.png" alt="Serper" width={16} height={16} />
                    <span>Serper</span>
                  </div>
                </SelectItem>
                <SelectItem value="tavily">
                  <div className="flex items-center gap-2">
                    <Image src="/icons/tavily.png" alt="Tavily" width={16} height={16} />
                    <span>Tavily</span>
                  </div>
                </SelectItem>
                <SelectItem value="brave">
                  <div className="flex items-center gap-2">
                    <Image src="/icons/brave.png" alt="Brave" width={16} height={16} />
                    <span>Brave</span>
                  </div>
                </SelectItem>
                <SelectItem value="bing">
                  <div className="flex items-center gap-2">
                    <Image src="/icons/serpapi.svg" alt="SerpApi" width={16} height={16} />
                    <span>Bing (via SerpApi)</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 pt-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">
                {form.webSearchProvider === 'serper' || form.webSearchProvider === 'google'
                  ? 'Serper API Key'
                  : form.webSearchProvider === 'brave'
                  ? 'Brave API Key'
                  : form.webSearchProvider === 'bing'
                  ? 'SerpApi API Key'
                  : 'Tavily API Key'}
              </Label>
              {verifyStatus.status === 'success' && (
                <span className="text-[10px] text-green-500 font-medium">✓ Verified</span>
              )}
              {verifyStatus.status === 'error' && (
                <span className="text-[10px] text-red-500 font-medium truncate max-w-[150px]">
                  {verifyStatus.message}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  className="text-sm pr-10"
                  value={
                    form.webSearchProvider === 'serper' || form.webSearchProvider === 'google'
                      ? form.serperApiKey || ''
                      : form.webSearchProvider === 'brave'
                      ? form.braveApiKey || ''
                      : form.webSearchProvider === 'bing'
                      ? form.bingApiKey || ''
                      : form.tavilyApiKey || ''
                  }
                  onChange={(e) => {
                    setVerifyStatus({ status: null });
                    if (
                      form.webSearchProvider === 'serper' ||
                      form.webSearchProvider === 'google'
                    ) {
                      setForm({ ...form, serperApiKey: e.target.value });
                    } else if (form.webSearchProvider === 'brave') {
                      setForm({ ...form, braveApiKey: e.target.value });
                    } else if (form.webSearchProvider === 'bing') {
                      setForm({ ...form, bingApiKey: e.target.value });
                    } else {
                      setForm({ ...form, tavilyApiKey: e.target.value });
                    }
                  }}
                  placeholder={
                    form.webSearchProvider === 'serper' || form.webSearchProvider === 'google'
                      ? 'Your Serper API Key'
                      : form.webSearchProvider === 'brave'
                      ? 'Your Brave API Key'
                      : form.webSearchProvider === 'bing'
                      ? 'Your SerpApi API Key'
                      : 'Your Tavily API Key'
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent text-muted-foreground"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
              <Button
                className={'rounded-lg'}
                variant="outline"
                size="default"
                onClick={handleVerify}
                disabled={verifying}
              >
                {verifying ? <Loader2 className="size-4 animate-spin" /> : 'Verify'}
              </Button>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end pt-4 border-t">
          <Button
            size="sm"
            disabled={saving === 'webSearch' || !dirtyWebSearch}
            onClick={() => handleSave('webSearch')}
            className="gap-1.5"
          >
            {saving === 'webSearch' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </CardFooter>
      </Card>

      {/* Scraper */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Web Scraper</CardTitle>
          <CardDescription className="text-xs">
            Configure proxy and scraping settings for data collection.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Proxy Server</Label>
            <Input
              className="text-sm"
              value={form.scraperProxyServer || ''}
              onChange={(e) => setForm({ ...form, scraperProxyServer: e.target.value })}
              placeholder="http://proxy.example.com:8080"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Proxy Username</Label>
              <Input
                className="text-sm"
                value={form.scraperProxyUsername || ''}
                onChange={(e) => setForm({ ...form, scraperProxyUsername: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Proxy Password</Label>
              <Input
                type="password"
                className="text-sm"
                value={form.scraperProxyPassword || ''}
                onChange={(e) => setForm({ ...form, scraperProxyPassword: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5 pt-2">
            <Label className="text-xs">Firecrawl API Key (Cloud)</Label>
            <Input
              type="password"
              className="text-sm"
              value={form.firecrawlApiKey || ''}
              onChange={(e) => setForm({ ...form, firecrawlApiKey: e.target.value })}
              placeholder="fc-..."
            />
          </div>
        </CardContent>
        <CardFooter className="flex justify-end pt-4 border-t">
          <Button
            size="sm"
            disabled={saving === 'scraper' || !dirtyScraper}
            onClick={() => handleSave('scraper')}
            className="gap-1.5"
          >
            {saving === 'scraper' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
