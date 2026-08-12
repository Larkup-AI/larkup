'use client';

import { useState, useEffect } from 'react';
import {
  Bot,
  Plus,
  Trash2,
  Tag,
  ChevronRight,
  Rocket,
  History,
  RotateCcw,
  CheckCircle2,
  CircleDot,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AgentIntegrationDialog } from '@/components/settings/agent-integration-dialog';
import { AgentChannelsDialog } from '@/components/settings/agent-channels-dialog';
import { AgentDeployDialog } from '@/components/settings/agent-deploy-dialog';

/* ------------------------------------------------------------------ */
/* Local shape mirrors (avoids pulling agent-contracts barrel into    */
/* the client bundle — execution.ts in that package uses CJS require) */
/* ------------------------------------------------------------------ */

interface AgentDef {
  id: string;
  name: string;
  description?: string;
  chatProvider: string;
  chatModelId: string;
  systemPrompt: string;
}

interface AgentRel {
  releaseId: string;
  version: string;
  publishedAt: string;
  isActive: boolean;
  releaseNotes?: string;
}

/* ------------------------------------------------------------------ */
/* Create agent dialog                                                 */
/* ------------------------------------------------------------------ */

function CreateAgentDialog({ onCreated }: { onCreated: (agent: AgentDef) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [chatProvider, setChatProvider] = useState('openai');
  const [chatModelId, setChatModelId] = useState('gpt-4o-mini');
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!name.trim()) {
      toast.error('Agent name is required');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, systemPrompt, chatProvider, chatModelId }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const agent: AgentDef = await res.json();
      toast.success(`Agent "${agent.name}" created`);
      onCreated(agent);
      setOpen(false);
      setName('');
      setDescription('');
      setSystemPrompt('You are a helpful assistant.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" className="gap-1.5">
            <Plus className="size-3.5" />
            New Agent
          </Button>
        }
      />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Agent</DialogTitle>
          <DialogDescription>
            Define your Agent&apos;s identity, model, and system prompt. You can update everything
            later.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              placeholder="Customer Support Bot"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-desc">Description</Label>
            <Input
              id="agent-desc"
              placeholder="Answers questions about our product"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Provider</Label>
              <Select value={chatProvider} onValueChange={(value) => setChatProvider(value ?? '')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="mistral">Mistral</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Model</Label>
              <Input
                placeholder="gpt-4o-mini"
                value={chatModelId}
                onChange={(e) => setChatModelId(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="system-prompt">System Prompt</Label>
            <Textarea
              id="system-prompt"
              className="min-h-[100px] font-mono text-xs"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating…' : 'Create Agent'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Release history dialog                                              */
/* ------------------------------------------------------------------ */

function ReleaseHistoryDialog({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [open, setOpen] = useState(false);
  const [releases, setReleases] = useState<AgentRel[]>([]);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [newVersion, setNewVersion] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');

  async function loadReleases() {
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/releases`);
      if (res.ok) setReleases(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    if (!newVersion.trim()) {
      toast.error('Version is required');
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/releases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: newVersion, releaseNotes }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(`Release v${newVersion} published`);
      setNewVersion('');
      setReleaseNotes('');
      await loadReleases();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }

  async function rollback(releaseId: string, version: string) {
    try {
      const res = await fetch(`/api/agents/${agentId}/releases/${releaseId}/activate`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(`Rolled back to v${version}`);
      await loadReleases();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Rollback failed');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) void loadReleases();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs text-muted-foreground">
            <History className="size-3" />
            Releases
          </Button>
        }
      />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Release History — {agentName}</DialogTitle>
          <DialogDescription>
            Each release is an immutable snapshot. Roll back by activating a prior release.
          </DialogDescription>
        </DialogHeader>

        {/* Publish new release */}
        <div className="border rounded-lg p-4 bg-muted/30 grid gap-3">
          <p className="text-sm font-medium">Publish new release</p>
          <div className="flex gap-2">
            <Input
              placeholder="1.0.0"
              className="w-28 font-mono text-xs"
              value={newVersion}
              onChange={(e) => setNewVersion(e.target.value)}
            />
            <Input
              placeholder="Release notes (optional)"
              className="flex-1 text-xs"
              value={releaseNotes}
              onChange={(e) => setReleaseNotes(e.target.value)}
            />
            <Button
              size="sm"
              onClick={() => void publish()}
              disabled={publishing}
              className="gap-1.5"
            >
              <Rocket className="size-3.5" />
              {publishing ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
        </div>

        {/* Release list */}
        <div className="max-h-72 overflow-y-auto grid gap-2">
          {loading && <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>}
          {!loading && releases.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No releases yet.</p>
          )}
          {releases.map((r) => (
            <div key={r.releaseId} className="flex items-center gap-3 border rounded-lg px-4 py-3">
              <div className="shrink-0">
                {r.isActive ? (
                  <CheckCircle2 className="size-4 text-green-500" />
                ) : (
                  <CircleDot className="size-4 text-muted-foreground/40" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Tag className="size-3 text-muted-foreground" />
                  <span className="font-mono text-sm font-medium">v{r.version}</span>
                  {r.isActive && (
                    <Badge variant="outline" className="text-[10px] h-4">
                      active
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(r.publishedAt).toLocaleString()}
                  {r.releaseNotes && ` · ${r.releaseNotes}`}
                </p>
              </div>
              {!r.isActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs h-7"
                  onClick={() => void rollback(r.releaseId, r.version)}
                >
                  <RotateCcw className="size-3" />
                  Rollback
                </Button>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Agent card                                                          */
/* ------------------------------------------------------------------ */

function AgentCard({ agent, onDeleted }: { agent: AgentDef; onDeleted: () => void }) {
  async function handleDelete() {
    if (!confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success('Agent deleted');
      onDeleted();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="flex items-start gap-4 border rounded-xl p-4 hover:bg-muted/30 transition-colors group">
      <div className="shrink-0 size-10 rounded-lg bg-primary/10 flex items-center justify-center">
        <Bot className="size-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{agent.name}</span>
          <span className="text-xs text-muted-foreground font-mono">
            {agent.chatProvider}/{agent.chatModelId}
          </span>
        </div>
        {agent.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{agent.description}</p>
        )}
        <div className="flex items-center gap-1 mt-2">
          <ReleaseHistoryDialog agentId={agent.id} agentName={agent.name} />
          <AgentIntegrationDialog agentId={agent.id} agentName={agent.name} />
          <AgentChannelsDialog agentId={agent.id} agentName={agent.name} />
          <AgentDeployDialog agentId={agent.id} agentName={agent.name} />
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          onClick={() => void handleDelete()}
        >
          <Trash2 className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-7">
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main section                                                        */
/* ------------------------------------------------------------------ */

export function AgentSection() {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadAgents() {
    setLoading(true);
    try {
      const res = await fetch('/api/agents');
      if (res.ok) setAgents(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAgents();
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="size-4" />
              Agents
            </CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              Create, publish, and roll back AI Agents. Each Agent connects to Knowledge Servers and
              runs typed tools.
            </CardDescription>
          </div>
          <CreateAgentDialog onCreated={(a) => setAgents((prev) => [a, ...prev])} />
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading agents…</p>
        )}
        {!loading && agents.length === 0 && (
          <div className="border-2 border-dashed rounded-xl py-10 text-center">
            <Bot className="size-8 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">No agents yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Create your first Agent to get started.
            </p>
          </div>
        )}
        {!loading && agents.length > 0 && (
          <div className="grid gap-2">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onDeleted={() => setAgents((prev) => prev.filter((a) => a.id !== agent.id))}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
