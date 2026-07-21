'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Loader2, Save, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { RagConfig } from '@larkup/core/types';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { Switch } from './ui/switch';

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

export function GlobalSettings({ onBack }: { onBack: () => void }) {
  const { data, isLoading, mutate } = useSWR('/api/config', fetcher);
  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [saving, setSaving] = useState(false);

  const searchParams = useSearchParams();
  const highlightSerper = searchParams.get('settings') === 'serper';
  const router = useRouter();
  const pathname = usePathname();
  const { setMode } = useWorkspace();

  useEffect(() => {
    if (data?.config) {
      setForm(data.config);
    }
  }, [data]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data?.config, ...form }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save configuration');

      await mutate(json, { revalidate: false });
      toast.success('Global Settings saved');

      if (highlightSerper) {
        // Remove the query param if it was set
        const params = new URLSearchParams(searchParams);
        params.delete('settings');
        router.replace(`${pathname}?${params.toString()}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="border-b px-4 py-3 font-semibold flex items-center gap-2 shrink-0 bg-muted/30">
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="flex-1 truncate">Global Settings</span>
        <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 px-3 text-xs">
          {saving ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Save className="h-3 w-3 mr-1" />
          )}
          Save
        </Button>
      </div>

      <div className="flex-1 min-h-0 p-4 space-y-6 overflow-y-auto ">
        <div className="space-y-4">
          <div className=" bg-card text-card-foreground  p-3 space-y-3">
            <h4 className="font-semibold leading-none tracking-tight text-sm">Embedding</h4>
            <div className="space-y-1.5">
              <Label className="text-xs">Provider</Label>
              <Select
                value={form.embeddingProvider || ''}
                onValueChange={(v) =>
                  setForm({ ...form, embeddingProvider: v === null ? undefined : v })
                }
              >
                <SelectTrigger className="h-8! text-sm w-full">
                  <span>{form.embeddingProvider || 'Select provider'}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="cohere">Cohere</SelectItem>
                  <SelectItem value="mistral">Mistral</SelectItem>
                  <SelectItem value="deepseek">DeepSeek</SelectItem>
                  <SelectItem value="vercel_ai_gateway">Vercel AI Gateway</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">API Key</Label>
              <Input
                type="password"
                className="h-8 text-sm"
                value={form.embeddingApiKey || ''}
                onChange={(e) => setForm({ ...form, embeddingApiKey: e.target.value })}
                placeholder="sk-..."
              />
            </div>
          </div>

          <div className="  text-card-foreground  p-3 space-y-3">
            <h4 className="font-semibold leading-none tracking-tight text-sm">Chat (LLM)</h4>
            <div className="space-y-1.5">
              <Label className="text-xs">Provider</Label>
              <Select
                value={form.chatProvider || form.embeddingProvider || ''}
                onValueChange={(v) =>
                  setForm({ ...form, chatProvider: v === null ? undefined : v })
                }
              >
                <SelectTrigger className="h-8! w-full text-sm">
                  <span>{form.chatProvider || form.embeddingProvider || 'Select provider'}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="cohere">Cohere</SelectItem>
                  <SelectItem value="mistral">Mistral</SelectItem>
                  <SelectItem value="deepseek">DeepSeek</SelectItem>
                  <SelectItem value="vercel_ai_gateway">Vercel AI Gateway</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">API Key</Label>
              <Input
                type="password"
                className="h-8 text-sm"
                value={form.chatApiKey || ''}
                onChange={(e) => setForm({ ...form, chatApiKey: e.target.value })}
                placeholder="Leave blank to use Embedding Key"
              />
            </div>
          </div>

          <div className=" bg-card text-card-foreground  p-3 space-y-3">
            <h4 className="font-semibold leading-none tracking-tight text-sm">Web Search</h4>
            <div className="space-y-1.5">
              <Label className="text-xs">Serper.dev API Key</Label>
              <Input
                type="password"
                className={`h-8 text-sm ${
                  highlightSerper && !form.serperApiKey
                    ? 'border-red-500 focus-visible:ring-red-500'
                    : ''
                }`}
                value={form.serperApiKey || ''}
                onChange={(e) => setForm({ ...form, serperApiKey: e.target.value })}
                placeholder="Serper API Key"
              />
              {highlightSerper && !form.serperApiKey && (
                <p className="text-[10px] text-red-500">API Key is required for web search.</p>
              )}
            </div>
          </div>

          <div className=" bg-card text-card-foreground  p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold leading-none tracking-tight text-sm">Scraper</h4>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={form.useScraperProxy || false}
                  onCheckedChange={(checked) => setForm({ ...form, useScraperProxy: checked })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Proxy Server</Label>
              <Input
                className="h-8 text-sm"
                value={form.scraperProxyServer || ''}
                onChange={(e) => setForm({ ...form, scraperProxyServer: e.target.value })}
                placeholder="http://proxy.example.com:8080"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Proxy Username</Label>
              <Input
                className="h-8 text-sm"
                value={form.scraperProxyUsername || ''}
                onChange={(e) => setForm({ ...form, scraperProxyUsername: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Proxy Password</Label>
              <Input
                type="password"
                className="h-8 text-sm"
                value={form.scraperProxyPassword || ''}
                onChange={(e) => setForm({ ...form, scraperProxyPassword: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 pt-2">
              <Label className="text-xs">Firecrawl API Key (Cloud)</Label>
              <Input
                type="password"
                className="h-8 text-sm"
                value={form.firecrawlApiKey || ''}
                onChange={(e) => setForm({ ...form, firecrawlApiKey: e.target.value })}
                placeholder="fc-..."
              />
            </div>
          </div>

          <div className="bg-card text-card-foreground p-3 space-y-3 rounded-lg border">
            <h4 className="font-semibold leading-none tracking-tight text-sm">Workspace Mode</h4>
            <p className="text-xs text-muted-foreground">
              Switch to simple mode for a streamlined experience without pipeline configuration.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={async () => {
                await setMode('simple');
                router.push('/simple/chat');
              }}
            >
              Switch to Simple Mode
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
