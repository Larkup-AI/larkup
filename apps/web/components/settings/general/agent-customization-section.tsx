'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  FileText,
  Link,
  Loader2,
  Maximize,
  Plus,
  Puzzle,
  Save,
  Search,
  Trash2,
  Upload,
  Wrench,
  AlertCircle,
  Terminal,
  Laptop,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AgentSkill, RagConfig } from '@larkup/core/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { McpConnectionsSection } from '@/components/settings/general/mcp-connections-section';
import { SandboxSection } from '@/components/settings/general/sandbox-section';
import { LineTabs } from '@/components/ui/line-tabs';

import { BUILT_IN_TOOLS, type Tool } from '@/lib/constants/tools';

type MarketplaceTool = {
  id: string;
  name: string;
  description: string;
  status: 'available' | 'installed';
  icon?: string;
  packageName?: string;
  version?: string;
};
const fetcher = (url: string) => fetch(url).then((response) => response.json());

function frontmatterValue(content: string, key: string) {
  const match = content.match(new RegExp(`^${key}:\\s*[\"']?([^\\n\"']+)[\"']?\\s*$`, 'm'));
  return match?.[1]?.trim();
}

function SkillDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (skill: AgentSkill) => void;
}) {
  const [source, setSource] = useState<'inline' | 'remote'>('inline');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  function add() {
    if (source === 'inline' && !content.trim())
      return toast.error('Paste or upload a SKILL.md file first.');
    if (source === 'remote') {
      try {
        new URL(url);
      } catch {
        return toast.error('Enter a valid SKILL.md URL.');
      }
    }
    const inferredName = source === 'inline' ? frontmatterValue(content, 'name') : '';
    const inferredDescription = source === 'inline' ? frontmatterValue(content, 'description') : '';
    const skillName =
      name.trim() ||
      inferredName ||
      (source === 'remote' ? new URL(url).hostname : 'Untitled skill');
    onAdd({
      id: crypto.randomUUID(),
      name: skillName,
      description: inferredDescription || 'Custom agent workflow.',
      source,
      enabled: true,
      ...(source === 'inline' ? { content } : { url }),
      updatedAt: new Date().toISOString(),
    });
    setContent('');
    setUrl('');
    setName('');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl! overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Add an Agent Skill</DialogTitle>
          <DialogDescription>
            Skills use the open `SKILL.md` format: metadata plus task instructions and optional
            resources.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <label className="text-sm font-medium">Skill name</label>
            <Input
              aria-label="Skill name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name (read from metadata if blank)"
            />
          </div>

          <Tabs value={source} onValueChange={(value) => setSource(value as 'inline' | 'remote')}>
            <div className="flex items-center gap-1 mb-4 border-b border-border">
              {(['inline', 'remote'] as const).map((tab) => {
                const isActive = source === tab;
                const label = tab === 'inline' ? 'Local' : 'Remote';
                const Icon = tab === 'inline' ? FileText : Link;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSource(tab)}
                    className={cn(
                      'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors outline-none',
                      isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 motion-safe:duration-200"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <TabsContent value="inline" className="space-y-3 pt-0">
              <input
                ref={fileInput}
                type="file"
                accept=".md,text/markdown"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file) setContent(await file.text());
                  event.currentTarget.value = '';
                }}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Upload a portable SKILL.md or paste its full contents below.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  className="shrink-0 gap-1.5"
                >
                  <Upload className="size-3.5" />
                  Upload
                </Button>
              </div>
              <Textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={
                  '---\nname: release-checklist\ndescription: Safely prepare a production release.\n---\n\n# Instructions\n...'
                }
                className="min-h-40 resize-none font-mono text-xs"
              />
            </TabsContent>

            <TabsContent value="remote" className="space-y-3 pt-0">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Keep a canonical remote `SKILL.md` reference so a deployed agent can resolve the
                same versioned workflow.
              </p>
              <Input
                aria-label="Remote SKILL.md URL"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/skills/release/SKILL.md"
              />
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={add}>Add skill</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentCustomizationSection() {
  const { data: configData, mutate: mutateConfig } = useSWR<{ config: RagConfig }>(
    '/api/config',
    fetcher,
  );
  const { data: marketplaceData } = useSWR<{ tools: MarketplaceTool[] }>(
    '/api/marketplace',
    fetcher,
  );
  const { data: runtimeData } = useSWR<{ runtime?: { running?: boolean; endpoint?: string } }>(
    '/api/projects/runtime',
    fetcher,
  );
  const [prompt, setPrompt] = useState('');
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [skillSearch, setSkillSearch] = useState('');
  const [skillDialogOpen, setSkillDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('prompt');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (configData?.config) {
      setPrompt(configData.config.systemPrompt ?? '');
      setEnabledTools(configData.config.enabledTools ?? []);
      setSkills(configData.config.skills ?? []);
    }
  }, [configData]);
  const plugins = useMemo<Tool[]>(
    () =>
      (marketplaceData?.tools ?? [])
        .filter((tool) => tool.status === 'installed')
        .map((tool) => ({ ...tool, icon: Puzzle, plugin: true })),
    [marketplaceData],
  );
  const allTools = useMemo(() => [...BUILT_IN_TOOLS, ...plugins], [plugins]);
  const isEnabled = (id: string) => enabledTools.length === 0 || enabledTools.includes(id);
  async function save(patch: Partial<RagConfig>, message: string) {
    if (!configData?.config) return;
    setSaving(true);
    try {
      const selectedTools = patch.enabledTools ?? enabledTools;
      const installedPlugins = (marketplaceData?.tools ?? [])
        .filter(
          (tool) =>
            tool.status === 'installed' &&
            tool.packageName &&
            (selectedTools.length === 0 || selectedTools.includes(tool.id)),
        )
        .map((tool) => ({
          id: tool.id,
          name: tool.name,
          packageName: tool.packageName!,
          version: tool.version,
        }));
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...configData.config,
          ...patch,
          agentPlugins: marketplaceData ? installedPlugins : configData.config.agentPlugins,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not save Assistant settings.');
      await mutateConfig(data, { revalidate: false });
      toast.success(
        runtimeData?.runtime?.running
          ? `${message} Restart the running Agent to apply it.`
          : message,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save Assistant settings.');
    } finally {
      setSaving(false);
    }
  }
  function toggleTool(id: string, checked: boolean) {
    const allIds = allTools.map((tool) => tool.id);
    const known = enabledTools.length === 0 ? allIds : enabledTools;
    const next = checked ? [...new Set([...known, id])] : known.filter((toolId) => toolId !== id);
    setEnabledTools(next);
    void save({ enabledTools: next }, `${checked ? 'Enabled' : 'Disabled'} tool.`);
  }

  const filteredSkills = skills.filter(
    (s) =>
      !skillSearch.trim() ||
      s.name.toLowerCase().includes(skillSearch.trim().toLowerCase()) ||
      s.description.toLowerCase().includes(skillSearch.trim().toLowerCase()),
  );

  function toggleSkill(id: string, enabled: boolean) {
    const next = skills.map((skill) => (skill.id === id ? { ...skill, enabled } : skill));
    setSkills(next);
    void save({ skills: next }, `${enabled ? 'Enabled' : 'Disabled'} skill.`);
  }

  if (!configData)
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  const ToolGrid = ({ title, tools, empty }: { title: string; tools: Tool[]; empty?: string }) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Wrench className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">{title}</h2>
      </div>
      {tools.length === 0 ? (
        <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <div
                key={tool.id}
                className="flex min-h-22 items-center gap-3 rounded-xl border bg-white/70 px-4 py-4 dark:bg-card/70"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                  <Icon className="size-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {tool.name}
                    {tool.plugin && (
                      <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                        Plugin
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {tool.description}
                  </p>
                </div>
                <Switch
                  checked={isEnabled(tool.id)}
                  disabled={saving}
                  aria-label={`Toggle ${tool.name}`}
                  onCheckedChange={(checked) => toggleTool(tool.id, checked)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Agent Customization</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set the instructions and local capabilities available to this Project’s Agent.
        </p>
      </div>
      {/* {runtimeData?.runtime?.running && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <span>Configuration changes are saved. Restart the local Agent to regenerate its prompt, skills, tools, and sandbox settings.</span>
          {runtimeData.runtime.endpoint && <code className="shrink-0 text-foreground">{runtimeData.runtime.endpoint}</code>}
        </div>
      )} */}
      <LineTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          { id: 'prompt', label: 'Prompt', icon: Terminal },
          { id: 'tools', label: 'Tools', icon: Wrench },
          {
            id: 'skills',
            label: 'Skills',
            icon: (props) => <img src="/icons/agentskills.png" alt="" {...props} />,
          },
          {
            id: 'mcp',
            label: 'MCP',
            icon: (props) => <img src="/icons/mcp.svg" alt="" {...props} />,
          },
          { id: 'sandbox', label: 'Sandbox', icon: Laptop },
        ]}
        className="mb-6 pb-0"
      />

      {activeTab === 'prompt' && (
        <div className="pt-2 animate-in fade-in-0 duration-200">
          <div className="rounded-xl border bg-white/70 p-5 dark:bg-card/70">
            <label htmlFor="assistant-system-prompt" className="text-sm font-medium">
              System prompt
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Larkup combines these instructions with its retrieval and tool safety rules.
            </p>
            <div className="relative mt-4">
              <Textarea
                id="assistant-system-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="You are a helpful research assistant..."
                className="min-h-52 max-h-60 resize-none pb-10 font-mono text-sm"
              />
              <Dialog>
                <DialogTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Expand system prompt"
                      className="absolute bottom-2 right-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Maximize className="size-4" />
                    </button>
                  }
                />
                <DialogContent className="max-w-[90vw] sm:max-w-4xl w-[90vw] h-[90vh] sm:max-h-200 flex flex-col">
                  <DialogHeader className="shrink-0 space-y-0 p-3 pb-0">
                    <div className="flex items-center gap-2">
                      <DialogTitle className="text-lg font-semibold">
                        Edit system prompt
                      </DialogTitle>
                      <FileText className="size-4 text-muted-foreground" />
                    </div>
                    <DialogDescription>
                      Edit the complete prompt without resizing the settings page.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex-1 min-h-0 mt-2 relative">
                    <Textarea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="You are a helpful research assistant..."
                      className="h-full w-full rounded-lg border border-border/40 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-border resize-none [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent font-mono"
                    />
                  </div>
                  <DialogFooter className="mt-6 justify-end flex items-center gap-2 shrink-0">
                    <DialogClose render={<Button variant="outline" className="px-3" />}>
                      Done
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                onClick={() => void save({ systemPrompt: prompt }, 'Agent prompt saved.')}
                disabled={saving}
              >
                <Save className="size-4" />
                Save prompt
              </Button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tools' && (
        <div className="pt-2 animate-in fade-in-0 duration-200 space-y-7">
          <ToolGrid title="Built-in tools" tools={BUILT_IN_TOOLS} />
          <ToolGrid
            title="Marketplace plugins"
            tools={plugins}
            empty="You have not enabled any local capabilities."
          />
        </div>
      )}

      {activeTab === 'skills' && (
        <div className="pt-2 animate-in fade-in-0 duration-200 space-y-4">
          <SkillDialog
            open={skillDialogOpen}
            onOpenChange={setSkillDialogOpen}
            onAdd={(skill) => {
              const next = [...skills, skill];
              setSkills(next);
              void save({ skills: next }, 'Skill added.');
              setSkillDialogOpen(false);
            }}
          />

          <div className="w-full gap-3 flex items-center justify-between">
            {skills.length > 0 && (
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search skills…"
                  className="h-9 pl-9 w-full bg-white/70 dark:bg-card/70"
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                />
              </div>
            )}

            <div className="flex flex-wrap items-start justify-between gap-4 ml-auto">
              {skills.length > 0 && (
                <Button
                  onClick={() => setSkillDialogOpen(true)}
                  size="default"
                  className="gap-1.5 px-3"
                >
                  <Plus className="size-3.5" /> Add skill
                </Button>
              )}
            </div>
          </div>

          {skills.length === 0 ? (
            <div className="rounded-xl px-4 py-20 dark:bg-card/40">
              <div className="flex flex-col items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-xl border border-border dark:bg-secondary/70">
                  <img src="/icons/agentskills.png" alt="" className="size-6 object-contain" />
                </div>
                <div className="text-center">
                  <h2 className="text-base font-semibold tracking-tight">No skills added yet</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Import a SKILL.md or keep a canonical remote skill URL.
                  </p>
                </div>
                <Button onClick={() => setSkillDialogOpen(true)} className="mt-2 gap-1.5">
                  <Plus className="size-4" /> Add skill
                </Button>
              </div>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-white/60 px-4 py-14 dark:bg-card/40">
              <AlertCircle className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No skills match &ldquo;{skillSearch}&rdquo;
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredSkills.map((skill) => (
                <div
                  key={skill.id}
                  className="flex items-start gap-3 rounded-xl border bg-white/70 p-4 dark:bg-card/70"
                >
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                    {skill.source === 'remote' ? (
                      <Link className="size-4" />
                    ) : (
                      <img src="/icons/agentskills.png" alt="" className="size-4 object-contain" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{skill.name}</p>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {skill.source === 'remote' ? 'Remote' : 'SKILL.md'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
                    {skill.url && (
                      <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
                        {skill.url}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      className={''}
                      checked={skill.enabled !== false}
                      disabled={saving}
                      aria-label={`Toggle ${skill.name}`}
                      onCheckedChange={(enabled) => toggleSkill(skill.id, enabled)}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${skill.name}`}
                      onClick={() => {
                        const next = skills.filter((item) => item.id !== skill.id);
                        setSkills(next);
                        void save({ skills: next }, 'Skill removed.');
                      }}
                    >
                      <Trash2 className="size-4 hover:text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'mcp' && (
        <div className="pt-2 animate-in fade-in-0 duration-200">
          <McpConnectionsSection />
        </div>
      )}

      {activeTab === 'sandbox' && (
        <div className="pt-2 animate-in fade-in-0 duration-200">
          <SandboxSection embedded />
        </div>
      )}
    </section>
  );
}
