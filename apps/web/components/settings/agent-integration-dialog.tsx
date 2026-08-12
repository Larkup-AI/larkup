'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  Globe,
  Loader2,
  Palette,
  Plus,
  Share2,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/* ------------------------------------------------------------------ */
/* Local shape mirrors (see agent-section.tsx for why)                 */
/* ------------------------------------------------------------------ */

interface WidgetStyle {
  primaryColor: string;
  position: 'bottom-right' | 'bottom-left';
  title: string;
  welcomeMessage: string;
  placeholder: string;
  avatarUrl?: string;
  darkMode: boolean;
  borderRadius: 'sm' | 'md' | 'lg' | 'full';
}

const DEFAULT_STYLE: WidgetStyle = {
  primaryColor: '#6366f1',
  position: 'bottom-right',
  title: 'Chat with Agent',
  welcomeMessage: 'Hi! How can I help you today?',
  placeholder: 'Type a message…',
  darkMode: false,
  borderRadius: 'lg',
};

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Could not copy — select the snippet and copy manually.');
    }
  }

  return (
    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void copy()}>
      {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

function Snippet({ code }: { code: string }) {
  return (
    <div className="relative rounded-lg border bg-muted/40">
      <div className="absolute right-2 top-2">
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto p-3 pr-24 font-mono text-[11px] leading-relaxed">{code}</pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Allowed origins editor                                              */
/* ------------------------------------------------------------------ */

function OriginsEditor({
  origins,
  onChange,
}: {
  origins: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const wildcard = origins.includes('*');

  function add() {
    const value = draft.trim().replace(/\/+$/, '');
    if (!value) return;
    if (origins.includes(value)) {
      toast.error(`"${value}" is already allowed`);
      return;
    }
    onChange([...origins, value]);
    setDraft('');
  }

  return (
    <div className="grid gap-2.5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-3.5 text-muted-foreground" />
        <Label className="text-sm">Allowed origins</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Only these websites may embed this agent. Requests from anywhere else are rejected with 403
        before the agent runs.
      </p>

      <div className="flex gap-2">
        <Input
          placeholder="https://www.example.com"
          className="h-8 text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={add}>
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>

      {origins.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {origins.map((origin) => (
            <Badge
              key={origin}
              variant={origin === '*' ? 'destructive' : 'secondary'}
              className="gap-1 pr-1 font-mono text-[11px] font-normal"
            >
              {origin}
              <button
                type="button"
                aria-label={`Remove ${origin}`}
                className="rounded-sm opacity-60 hover:opacity-100"
                onClick={() => onChange(origins.filter((o) => o !== origin))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {origins.length === 0 && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          No origins allowed yet — every embed will be rejected. Add the site that will host the
          widget.
        </p>
      )}

      {wildcard && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
          <span>
            <strong className="font-medium">
              &quot;*&quot; lets any website on the internet chat with this agent
            </strong>{' '}
            — and spend your model budget. Fine while developing; replace it with your real domains
            before launch.
          </span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Supports <code className="font-mono">https://app.example.com</code>,{' '}
        <code className="font-mono">https://*.example.com</code> for subdomains, and{' '}
        <code className="font-mono">example.com</code> to allow both schemes. Requests from this
        dashboard are always allowed.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rate limiting (plan §8.5)                                           */
/* ------------------------------------------------------------------ */

function RateLimitEditor({
  dailyTokenCeiling,
  onChange,
}: {
  dailyTokenCeiling: number | undefined;
  onChange: (next: number | undefined) => void;
}) {
  return (
    <div className="grid gap-2.5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-3.5 text-muted-foreground" />
        <Label className="text-sm">Daily token ceiling</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Requests/minute (5 burst, 20/min sustained) and 50 messages/session apply to every agent
        automatically. This ceiling is the one that bounds the bill — off by default, so set it to
        stop a busy agent once it has used this many tokens in a rolling 24 hours. Model requests
        past the ceiling are refused with a 429 until it rolls back down.
      </p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          step={1000}
          placeholder="No ceiling"
          className="h-8 w-40 text-xs"
          value={dailyTokenCeiling ?? ''}
          onChange={(e) => {
            const raw = e.target.value.trim();
            onChange(raw ? Math.max(0, Math.floor(Number(raw))) : undefined);
          }}
        />
        <span className="text-xs text-muted-foreground">tokens/day</span>
        {dailyTokenCeiling ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => onChange(undefined)}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Appearance editor                                                   */
/* ------------------------------------------------------------------ */

function AppearanceEditor({
  style,
  onChange,
}: {
  style: WidgetStyle;
  onChange: (next: WidgetStyle) => void;
}) {
  const set = <K extends keyof WidgetStyle>(key: K, value: WidgetStyle[K]) =>
    onChange({ ...style, [key]: value });

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Palette className="size-3.5 text-muted-foreground" />
        <Label className="text-sm">Appearance</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Applies to every embed of this agent. A snippet can still override any of these locally.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs">Panel title</Label>
          <Input
            className="h-8 text-xs"
            value={style.title}
            onChange={(e) => set('title', e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Accent color</Label>
          <div className="flex gap-2">
            <input
              type="color"
              aria-label="Accent color"
              className="h-8 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent"
              value={style.primaryColor}
              onChange={(e) => set('primaryColor', e.target.value)}
            />
            <Input
              className="h-8 font-mono text-xs"
              value={style.primaryColor}
              onChange={(e) => set('primaryColor', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs">Welcome message</Label>
        <Input
          className="h-8 text-xs"
          value={style.welcomeMessage}
          onChange={(e) => set('welcomeMessage', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs">Input placeholder</Label>
          <Input
            className="h-8 text-xs"
            value={style.placeholder}
            onChange={(e) => set('placeholder', e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Position</Label>
          <Select
            value={style.position}
            onValueChange={(value) => set('position', value as WidgetStyle['position'])}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bottom-right">Bottom right</SelectItem>
              <SelectItem value="bottom-left">Bottom left</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Corners</Label>
          <Select
            value={style.borderRadius}
            onValueChange={(value) => set('borderRadius', value as WidgetStyle['borderRadius'])}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sm">Sharp</SelectItem>
              <SelectItem value="md">Soft</SelectItem>
              <SelectItem value="lg">Rounded</SelectItem>
              <SelectItem value="full">Pill</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border px-3 py-2">
        <div>
          <p className="text-xs font-medium">Dark panel</p>
          <p className="text-[11px] text-muted-foreground">Match a dark host website.</p>
        </div>
        <Switch checked={style.darkMode} onCheckedChange={(value) => set('darkMode', value)} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Install snippets                                                    */
/* ------------------------------------------------------------------ */

function InstallTabs({ agentId, host }: { agentId: string; host: string }) {
  const scriptSnippet = `<script async
  src="${host}/api/widget.js"
  data-agent="${agentId}"></script>`;

  const reactSnippet = `// app/layout.tsx — load the widget once, on the client
'use client';
import Script from 'next/script';

export function LarkupWidget() {
  return (
    <Script
      async
      src="${host}/api/widget.js"
      data-agent="${agentId}"
      strategy="afterInteractive"
    />
  );
}`;

  const apiSnippet = `curl -N ${host}/api/agents/${agentId}/chat \\
  -H 'Content-Type: application/json' \\
  -d '{"messages":[{"role":"user","content":"Hello"}]}'`;

  return (
    <Tabs defaultValue="website" className="gap-3">
      <TabsList className="w-full">
        <TabsTrigger value="website" className="gap-1.5">
          <Globe className="size-3.5" />
          Website
        </TabsTrigger>
        <TabsTrigger value="react" className="gap-1.5">
          <Code2 className="size-3.5" />
          React
        </TabsTrigger>
        <TabsTrigger value="api" className="gap-1.5">
          <Terminal className="size-3.5" />
          API
        </TabsTrigger>
      </TabsList>

      <TabsContent value="website" className="grid gap-2">
        <p className="text-xs text-muted-foreground">
          Paste this before <code className="font-mono">&lt;/body&gt;</code> on any page. The widget
          reads its host from the script URL, so nothing else is needed.
        </p>
        <Snippet code={scriptSnippet} />
        <p className="text-xs text-muted-foreground">
          Optional attributes: <code className="font-mono">data-primary-color</code>,{' '}
          <code className="font-mono">data-position</code>,{' '}
          <code className="font-mono">data-theme</code>,{' '}
          <code className="font-mono">data-title</code>,{' '}
          <code className="font-mono">data-open</code>.
        </p>
      </TabsContent>

      <TabsContent value="react" className="grid gap-2">
        <p className="text-xs text-muted-foreground">
          The widget mounts its own React root inside a Shadow DOM, so it never touches your
          app&apos;s React tree or styles.
        </p>
        <Snippet code={reactSnippet} />
      </TabsContent>

      <TabsContent value="api" className="grid gap-2">
        <p className="text-xs text-muted-foreground">
          Server-to-server calls carry no <code className="font-mono">Origin</code> header, so the
          allowed-origins list does not apply to them.
        </p>
        <Snippet code={apiSnippet} />
      </TabsContent>
    </Tabs>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function AgentIntegrationDialog({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [origins, setOrigins] = useState<string[]>([]);
  const [style, setStyle] = useState<WidgetStyle>(DEFAULT_STYLE);
  const [dailyTokenCeiling, setDailyTokenCeiling] = useState<number | undefined>(undefined);
  const [host, setHost] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') setHost(window.location.origin);
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`);
      if (!res.ok) throw new Error((await res.json()).error);
      const agent = await res.json();
      setOrigins(Array.isArray(agent.allowedOrigins) ? agent.allowedOrigins : []);
      setStyle({ ...DEFAULT_STYLE, ...(agent.widgetStyle ?? {}) });
      setDailyTokenCeiling(agent.dailyTokenCeiling ? agent.dailyTokenCeiling : undefined);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load agent settings');
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowedOrigins: origins,
          widgetStyle: style,
          // 0 rather than omitting the key: `PUT` merges by spreading the
          // partial update over the stored definition, so an omitted key
          // would leave a previously-set ceiling in place instead of
          // clearing it. `precheckDailyBudget`/`chargeDailyBudget` already
          // treat 0 the same as unset — both mean "off."
          dailyTokenCeiling: dailyTokenCeiling ?? 0,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success('Widget settings saved — live on every embed immediately.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) void load();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground">
            <Share2 className="size-3" />
            Connect
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect — {agentName}</DialogTitle>
          <DialogDescription>
            Embed this agent on a website. The browser only ever receives the public agent ID —
            model keys and knowledge-server credentials stay on the server.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading settings…
          </div>
        ) : (
          <div className="grid gap-6 py-1">
            <InstallTabs agentId={agentId} host={host} />
            <div className="h-px bg-border" />
            <OriginsEditor origins={origins} onChange={setOrigins} />
            <div className="h-px bg-border" />
            <RateLimitEditor
              dailyTokenCeiling={dailyTokenCeiling}
              onChange={setDailyTokenCeiling}
            />
            <div className="h-px bg-border" />
            <AppearanceEditor style={style} onChange={setStyle} />

            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save widget settings'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
