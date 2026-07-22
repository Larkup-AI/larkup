'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Loader2, Save, Maximize, FileText } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import type { RagConfig } from '@larkup/core/types';
import { DEFAULT_SYSTEM_PROMPT } from '@larkup/core/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

export function PromptsSection() {
  const { activeServer } = useWorkspace();
  const serverId = activeServer?.id;
  const configUrl = serverId
    ? `/api/config?serverId=${encodeURIComponent(serverId)}`
    : '/api/config';
  const { data, isLoading, mutate } = useSWR(configUrl, fetcher);
  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.config) {
      setForm({
        ...data.config,
        systemPrompt: data.config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      });
    }
  }, [data]);

  const dirty =
    (form.systemPrompt || '') !== (data?.config?.systemPrompt || '') ||
    JSON.stringify(form.enabledTools || []) !== JSON.stringify(data?.config?.enabledTools || []);

  async function handleSave() {
    setSaving(true);
    try {
      const merged = { ...data?.config, ...form };
      const res = await fetch(configUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save');
      await mutate(json, { revalidate: false });
      toast.success('Prompt saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
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
          <h2 className="text-lg font-semibold tracking-tight">Agent Customization</h2>
          <p className="text-sm text-muted-foreground">
            Customize the instructions and tools given to your AI assistant.
          </p>
        </div>
        <Button size="sm" disabled={saving || !dirty} onClick={handleSave} className="gap-1.5">
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </Button>
      </div>

      <Card className="bg-white/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">System Prompt</CardTitle>
          <CardDescription className="text-xs">
            Override the default instructions given to the AI. Leave blank for the default behavior.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Textarea
              value={form.systemPrompt || ''}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              placeholder="You are a helpful research assistant..."
              className="w-full rounded-lg border border-border/70 bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-border resize-none max-h-50 pb-10 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
            />
            <Dialog>
              <DialogTrigger
                render={
                  <button
                    type="button"
                    className="absolute bottom-2 right-2 p-1.5 text-muted-foreground/60 hover:text-foreground transition-colors rounded-md cursor-pointer"
                  >
                    <Maximize className="size-4" strokeWidth={1.75} />
                  </button>
                }
              />
              <DialogContent className="max-w-[90vw] sm:max-w-[90vw] w-[90vw] h-[90vh] flex flex-col ">
                <DialogHeader className="shrink-0 space-y-0 p-3 pb-0">
                  <div className="flex items-center gap-2">
                    <DialogTitle className="text-lg font-semibold">Edit text content.</DialogTitle>
                    <FileText className="size-4 text-muted-foreground" />
                  </div>
                  <DialogDescription>Edit text content.</DialogDescription>
                </DialogHeader>
                <div className="flex-1 min-h-0 mt-2 relative ">
                  <Textarea
                    value={form.systemPrompt || ''}
                    onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                    placeholder="You are a helpful research assistant..."
                    className="h-full w-full rounded-lg border border-border/40 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-border resize-none [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
                  />
                </div>
                <DialogFooter className="mt-6 justify-end flex items-center  gap-2 shrink-0">
                  <DialogClose render={<Button variant="outline" className={'px-3'} />}>
                    Cancel
                  </DialogClose>
                  <DialogClose render={<Button />}>Save</DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <AgentToolsCard form={form} setForm={setForm} />
    </div>
  );
}

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  Wrench,
  Puzzle,
  Film,
  ScanEye,
  Settings2,
  Search,
  Table,
  BarChart,
  Code,
  Files,
  FileEdit,
  PenTool,
  type LucideIcon,
} from 'lucide-react';
import { Textarea } from '../ui/textarea';

const BUILT_IN_TOOLS = [
  {
    id: 'searchKnowledgeBase',
    name: 'Semantic Search',
    desc: 'Search the RAG knowledge base for text.',
    icon: Search,
  },
  {
    id: 'queryTabularData',
    name: 'Tabular Data Query',
    desc: 'Filter, group, and aggregate tabular data.',
    icon: Table,
  },
  {
    id: 'generateVisualization',
    name: 'Generate Charts',
    desc: 'Create interactive Recharts visualizations.',
    icon: BarChart,
  },
  {
    id: 'executeAnalysis',
    name: 'Python Sandbox',
    desc: 'Execute Python code for complex analysis.',
    icon: Code,
  },
  {
    id: 'getIndexedData',
    name: 'Indexed Data',
    desc: 'List and filter source documents.',
    icon: Files,
  },
  {
    id: 'analyzeCorpusWithCode',
    name: 'Corpus Analysis',
    desc: 'Python sandbox with full corpus access.',
    icon: Code,
  },
  {
    id: 'fillDocumentForm',
    name: 'Form Filler',
    desc: 'Fill forms in the active document.',
    icon: FileEdit,
  },
  {
    id: 'editDocument',
    name: 'Document Editor',
    desc: 'Edit text in the active document.',
    icon: PenTool,
  },
];

const PLUGIN_ICON_MAP: Record<string, LucideIcon> = {
  Film,
  ScanEye,
};

function AgentToolsCard({ form, setForm }: { form: Partial<RagConfig>; setForm: any }) {
  const [activeTab, setActiveTab] = useState<'tools' | 'plugins'>('tools');
  const { data } = useSWR('/api/marketplace', (url) =>
    fetch(url).then((r) => r.json() as Promise<{ tools: any[] }>),
  );

  const installedMarketplaceTools = (data?.tools || []).filter(
    (t: any) => t.status === 'installed',
  );
  const allTools = [
    ...BUILT_IN_TOOLS,
    ...installedMarketplaceTools.map((t: any) => ({
      id: t.id,
      name: t.name,
      desc: t.description,
      isMarketplace: true,
      ...t,
    })),
  ];

  const enabledSet = new Set(form.enabledTools || []);

  const toggleTool = (id: string) => {
    const next = new Set(enabledSet);
    if (!form.enabledTools || form.enabledTools.length === 0) {
      allTools.forEach((t) => {
        if (t.id !== id) next.add(t.id);
      });
    } else {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    setForm({ ...form, enabledTools: Array.from(next) });
  };

  const isEnabled = (id: string) => {
    if (!form.enabledTools || form.enabledTools.length === 0) return true;
    return enabledSet.has(id);
  };

  const displayedTools =
    activeTab === 'tools'
      ? BUILT_IN_TOOLS
      : installedMarketplaceTools.map((t: any) => ({
          id: t.id,
          name: t.name,
          desc: t.description,
          isMarketplace: true,
          ...t,
        }));

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-sm">Agent Tools</CardTitle>
        <CardDescription className="text-xs">
          Select which tools the AI assistant is allowed to use.
        </CardDescription>

        {/* Tabs UI */}
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1 border border-border/90 rounded-lg bg-muted/60 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('tools')}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium transition-all duration-200 rounded-md',
                activeTab === 'tools'
                  ? 'bg-background text-foreground ring-1 ring-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
              )}
            >
              <Wrench className="size-3.5" strokeWidth={activeTab === 'tools' ? 2 : 1.75} />
              Tools
              <span className="ml-1 flex h-4 items-center justify-center rounded-full bg-secondary px-1.5 text-[10px] font-medium text-muted-foreground">
                {BUILT_IN_TOOLS.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('plugins')}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium transition-all duration-200 rounded-md',
                activeTab === 'plugins'
                  ? 'bg-background text-foreground ring-1 ring-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
              )}
            >
              <Puzzle className="size-3.5" strokeWidth={activeTab === 'plugins' ? 2 : 1.75} />
              Plugins
              <span className="ml-1 flex h-4 items-center justify-center rounded-full bg-secondary px-1.5 text-[10px] font-medium text-muted-foreground">
                {installedMarketplaceTools.length}
              </span>
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {displayedTools.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No plugins installed. Go to the Marketplace to install plugins.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {displayedTools.map((tool) => {
              const enabled = isEnabled(tool.id);
              // user asked for plugin ui as in marketplace, with background white, border-border/70
              // we apply bg-background to support dark mode gracefully
              return (
                <div
                  key={tool.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background px-4 py-3.5 transition-colors hover:border-border"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {(() => {
                      const IconComponent = tool.isMarketplace
                        ? tool.icon
                          ? PLUGIN_ICON_MAP[tool.icon as string] || Puzzle
                          : Puzzle
                        : tool.icon || Wrench;

                      return (
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/50 border">
                          {tool.emoji ? (
                            <span className="text-xl leading-none">{tool.emoji}</span>
                          ) : (
                            <IconComponent className="size-5 text-foreground" strokeWidth={1.75} />
                          )}
                        </div>
                      );
                    })()}
                    <div className="flex flex-col min-w-0">
                      <span className="text-[13px] font-medium text-foreground truncate">
                        {tool.name}
                        {tool.isMarketplace && (
                          <span className="ml-2 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            Plugin
                          </span>
                        )}
                      </span>
                      <p className="mt-0.5 text-[12px] text-muted-foreground leading-relaxed line-clamp-1">
                        {tool.desc}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={() => toggleTool(tool.id)}
                    aria-label={`Toggle ${tool.name}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
