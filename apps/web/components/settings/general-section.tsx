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
import { Tabs, TabsTrigger, TabsList, TabsContent } from '../ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

export function GeneralSection() {
  const { data, isLoading, mutate } = useSWR('/api/config', fetcher);
  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const { username, setUsername } = useWorkspace();
  const [localName, setLocalName] = useState(username || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showProxyPassword, setShowProxyPassword] = useState(false);
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
                  {form.webSearchProvider === 'exa' && (
                    <Image src="/icons/exa.png" alt="Exa" width={16} height={16} />
                  )}
                  {form.webSearchProvider === 'local' && (
                    <Image src="/icons/firecrawl.png" alt="Local" width={16} height={16} />
                  )}
                  <SelectValue placeholder="Select provider" />
                </div>
              </SelectTrigger>
              <SelectContent>
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
                <SelectItem value="exa">
                  <div className="flex items-center gap-2">
                    <Image src="/icons/exa.png" alt="Exa" width={16} height={16} />
                    <span>Exa</span>
                  </div>
                </SelectItem>
                <SelectItem value="local">
                  <div className="flex items-center gap-2">
                    <Image src="/icons/firecrawl.png" alt="Local Crawler" width={16} height={16} />
                    <span>Local (Firecrawl)</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.webSearchProvider !== 'local' && (
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
                  {form.webSearchProvider === 'serper' || form.webSearchProvider === 'google'
                    ? 'Serper API Key'
                    : form.webSearchProvider === 'brave'
                    ? 'Brave API Key'
                    : form.webSearchProvider === 'bing'
                    ? 'SerpApi API Key'
                    : form.webSearchProvider === 'exa'
                    ? 'Exa API Key'
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
                        : form.webSearchProvider === 'exa'
                        ? form.exaApiKey || ''
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
                      } else if (form.webSearchProvider === 'exa') {
                        setForm({ ...form, exaApiKey: e.target.value });
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
                        : form.webSearchProvider === 'exa'
                        ? 'Your Exa API Key'
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
          )}
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

      {/* Web Scraper Provider */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Web Scraper</CardTitle>
          <CardDescription className="text-xs">
            Select your web crawler provider (Local or Cloud).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Web Scraper Provider</Label>
            <Select
              value={form.webCrawlerProvider || 'local'}
              onValueChange={(val) => {
                setForm({ ...form, webCrawlerProvider: val as 'local' | 'cloud' });
                setVerifyCrawlerStatus({ status: null });
              }}
            >
              <SelectTrigger className="w-full">
                <div className="flex items-center gap-2">
                  <Image src="/icons/firecrawl.png" alt="Firecrawl" width={16} height={16} />
                  <span>
                    {form.webCrawlerProvider === 'cloud'
                      ? 'Firecrawl (Cloud)'
                      : 'Local (Firecrawl)'}
                  </span>
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">
                  <div className="flex items-center gap-2">
                    <Image src="/icons/firecrawl.png" alt="Local Crawler" width={16} height={16} />
                    <span>Local (Firecrawl)</span>
                  </div>
                </SelectItem>
                <SelectItem value="cloud">
                  <div className="flex items-center gap-2">
                    <Image
                      src="/icons/firecrawl.png"
                      alt="Firecrawl Cloud"
                      width={16}
                      height={16}
                    />
                    <span>Firecrawl (Cloud)</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.webCrawlerProvider === 'cloud' && (
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Firecrawl API Key (Cloud)</Label>
                {verifyCrawlerStatus.status === 'success' && (
                  <span className="text-[10px] text-green-500 font-medium">✓ Verified</span>
                )}
                {verifyCrawlerStatus.status === 'error' && (
                  <span className="text-[10px] text-red-500 font-medium truncate max-w-[150px]">
                    {verifyCrawlerStatus.message}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    className="text-sm pr-10"
                    value={form.firecrawlApiKey || ''}
                    onChange={(e) => {
                      setVerifyCrawlerStatus({ status: null });
                      setForm({ ...form, firecrawlApiKey: e.target.value });
                    }}
                    placeholder="fc-..."
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
                  className="rounded-lg"
                  variant="outline"
                  size="default"
                  disabled={verifyingCrawler}
                  onClick={handleVerifyCrawler}
                >
                  {verifyingCrawler ? <Loader2 className="size-4 animate-spin" /> : 'Verify'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end pt-4 border-t">
          <Button
            size="sm"
            disabled={saving === 'webCrawler' || !dirtyWebCrawler}
            onClick={() => handleSave('webCrawler')}
            className="gap-1.5"
          >
            {saving === 'webCrawler' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </CardFooter>
      </Card>

      {/* Proxy Settings */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-sm">Local Proxy Settings</CardTitle>
            <CardDescription className="text-xs">
              Configure proxy settings for the local scraper.
            </CardDescription>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={form.useScraperProxy || false}
                      onCheckedChange={(checked) => setForm({ ...form, useScraperProxy: checked })}
                    />
                  </div>
                }
              />
              <TooltipContent>
                <p>Enable proxy for web scraping</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="one-line" className="w-full ">
            <div className="flex mb-4">
              <TabsList className="grid w-[140px] grid-cols-2 h-8! bg-muted/10">
                <TabsTrigger value="one-line" className="text-xs h-6">
                  One Line
                </TabsTrigger>
                <TabsTrigger value="form" className="text-xs h-6">
                  Form
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="one-line" className="mt-0 w-full">
              <div className="space-y-1.5">
                <Label className="text-xs">Proxy URL</Label>
                <Input
                  className="text-sm"
                  value={(() => {
                    if (!form.scraperProxyServer) return '';
                    try {
                      const url = new URL(form.scraperProxyServer);
                      if (form.scraperProxyUsername)
                        url.username = encodeURIComponent(form.scraperProxyUsername);
                      if (form.scraperProxyPassword)
                        url.password = encodeURIComponent(form.scraperProxyPassword);
                      return url.toString().replace(/\/$/, '');
                    } catch {
                      return form.scraperProxyServer;
                    }
                  })()}
                  onChange={(e) => {
                    const val = e.target.value;
                    let server = val;
                    let username = '';
                    let password = '';
                    const trimmed = val.trim();
                    if (trimmed) {
                      try {
                        const url = new URL(trimmed);
                        if (url.username || url.password) {
                          username = decodeURIComponent(url.username);
                          password = decodeURIComponent(url.password);
                          url.username = '';
                          url.password = '';
                          server = url.toString().replace(/\/$/, '');
                        }
                      } catch {
                        const parts = trimmed.split(':');
                        if (parts.length === 4 && !trimmed.startsWith('http')) {
                          server = `http://${parts[0]}:${parts[1]}`;
                          username = parts[2];
                          password = parts[3];
                        }
                      }
                    }
                    setForm({
                      ...form,
                      scraperProxyServer: server,
                      scraperProxyUsername: username,
                      scraperProxyPassword: password,
                    });
                  }}
                  placeholder="http://proxy.example.com:8080 (or paste one-liner)"
                />
              </div>
            </TabsContent>

            <TabsContent value="form" className="mt-0 space-y-4">
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
                  <div className="relative">
                    <Input
                      type={showProxyPassword ? 'text' : 'password'}
                      className="text-sm pr-10"
                      value={form.scraperProxyPassword || ''}
                      onChange={(e) => setForm({ ...form, scraperProxyPassword: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent text-muted-foreground"
                      onClick={() => setShowProxyPassword(!showProxyPassword)}
                    >
                      {showProxyPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="flex justify-end gap-2 pt-4 border-t">
          <Button
            className="rounded-lg gap-2"
            variant="outline"
            size="sm"
            onClick={async () => {
              const promise = (async () => {
                if (!form.scraperProxyServer) {
                  throw new Error('Proxy server is required');
                }
                const res = await fetch('/api/proxy/verify', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    server: form.scraperProxyServer,
                    username: form.scraperProxyUsername,
                    password: form.scraperProxyPassword,
                  }),
                });
                const data = await res.json();
                if (!res.ok) {
                  throw new Error(data.error || 'Proxy verification failed');
                }
                return data;
              })();

              toast.promise(promise, {
                loading: 'Verifying proxy...',
                success: 'Proxy configuration is valid!',
                error: (err) => err.message || 'Proxy verification failed',
              });
            }}
          >
            Verify Proxy
          </Button>
          <Button
            size="sm"
            disabled={saving === 'proxy' || !dirtyProxy}
            onClick={() => handleSave('proxy')}
            className="gap-1.5"
          >
            {saving === 'proxy' ? (
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
