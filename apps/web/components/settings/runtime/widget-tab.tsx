'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Code2, Copy, Eye, EyeOff, KeyRound, Loader2, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { RagConfig } from '@larkup/core/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  DEFAULT_WIDGET_SETTINGS,
  type EmbedTab,
  type WidgetSettings,
} from './widget-snippets';

const fetcher = (url: string) => fetch(url).then((response) => response.json());

function CodeBlock({
  code,
  codeHiddenKey,
  showKey,
  onCopy,
}: {
  code: string;
  codeHiddenKey?: string;
  showKey?: boolean;
  onCopy: () => void;
}) {
  const displayCode = !showKey && codeHiddenKey ? codeHiddenKey : code;
  return (
    <div className="relative overflow-hidden rounded-xl border bg-muted/35 dark:bg-background/40">
      <Button variant="ghost" size="sm" className="absolute right-2 top-2 gap-1.5" onClick={onCopy}>
        <Copy className="size-3.5" /> Copy
      </Button>
      <pre className="overflow-x-auto p-4 pr-20 font-mono text-xs leading-6 text-foreground">
        {displayCode}
      </pre>
    </div>
  );
}

export function WidgetSection({ embedded = false }: { embedded?: boolean }) {
  const { data, mutate } = useSWR<{ config: RagConfig }>('/api/config', fetcher);
  const { data: runtimeData } = useSWR<{ runtime?: { endpoint?: string } }>(
    '/api/projects/runtime',
    fetcher,
  );
  const [widget, setWidget] = useState<WidgetSettings>(DEFAULT_WIDGET_SETTINGS);
  const [host, setHost] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [embedClass, setEmbedClass] = useState('');
  const [embedTab, setEmbedTab] = useState<EmbedTab>('javascript');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.config) setWidget({ ...DEFAULT_WIDGET_SETTINGS, ...data.config.widget });
  }, [data]);
  useEffect(() => {
    const stored = window.localStorage.getItem('larkup-server-api-key') ?? '';
    setApiKey(stored);
    setHost(runtimeData?.runtime?.endpoint || window.location.origin);
  }, [runtimeData?.runtime?.endpoint]);

  const snippets = useMemo(() => {
    const base = host.replace(/\/+$/, '') || 'https://YOUR-LARKUP-HOST';
    const key = apiKey || 'YOUR_SERVER_API_KEY';
    const hiddenKey = '********';

    const buildAttrs = (k: string) =>
      [
        `  src="${base}/widget.js"`,
        `  data-api-key="${k}"`,
        `  data-position="${widget.position}"`,
        `  data-theme="${widget.darkMode ? 'dark' : 'light'}"`,
        `  data-primary-color="${widget.primaryColor}"`,
        widget.logoUrl ? `  data-logo-url="${widget.logoUrl}"` : '',
        widget.customCss ? `  data-custom-css="${widget.customCss.replace(/"/g, '&quot;')}"` : '',
        embedClass ? `  data-class="${embedClass}"` : '',
      ]
        .filter(Boolean)
        .join('\n');

    const buildReact = (k: string) =>
      `'use client';\n\nimport { useEffect } from 'react';\n\nexport function LarkupWidget() {\n  useEffect(() => {\n    const script = document.createElement('script');\n    script.async = true;\n    script.src = '${base}/widget.js';\n    script.dataset.apiKey = '${k}';\n    script.dataset.position = '${
        widget.position
      }';\n    script.dataset.theme = '${
        widget.darkMode ? 'dark' : 'light'
      }';\n    script.dataset.primaryColor = '${widget.primaryColor}';\n    ${
        widget.logoUrl ? `script.dataset.logoUrl = '${widget.logoUrl}';\n    ` : ''
      }${
        widget.customCss ? `script.dataset.customCss = \`${widget.customCss}\`;\n    ` : ''
      }document.body.appendChild(script);\n    return () => window.LarkupWidget?.destroy();\n  }, []);\n\n  return null;\n}`;

    return {
      javascript: `<script\n  async\n${buildAttrs(key)}\n></script>`,
      javascriptHidden: `<script\n  async\n${buildAttrs(hiddenKey)}\n></script>`,
      react: buildReact(key),
      reactHidden: buildReact(hiddenKey),
      api: `curl -N ${base}/chat \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${key}" \\\n  -d '{"messages":[{"role":"user","content":"Hello"}]}'`,
      apiHidden: `curl -N ${base}/chat \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${hiddenKey}" \\\n  -d '{"messages":[{"role":"user","content":"Hello"}]}'`,
    };
  }, [
    apiKey,
    embedClass,
    host,
    widget.darkMode,
    widget.position,
    widget.primaryColor,
    widget.logoUrl,
    widget.customCss,
  ]);

  async function save() {
    if (!data?.config) return;
    setSaving(true);
    try {
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data.config, widget }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not save widget settings.');
      await mutate(result, { revalidate: false });
      toast.success('Widget appearance saved. Restart or redeploy the server to publish it.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save widget settings.');
    } finally {
      setSaving(false);
    }
  }
  async function copy(value: string, label = 'Code') {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  }
  if (!data)
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <section className="space-y-6">
      {!embedded && (
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Chat widget</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Customize a self-contained chat surface, then embed the generated server anywhere.
          </p>
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,.7fr)]">
        <div className="flex flex-col gap-5">
          <div className="rounded-xl border bg-card/60 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="widget-title">Widget title</Label>
                <Input
                  id="widget-title"
                  value={widget.title}
                  onChange={(e) => setWidget({ ...widget, title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="widget-color">Accent color</Label>
                <div className="flex gap-2">
                  <Input
                    id="widget-color"
                    type="color"
                    className="w-12 p-1"
                    value={widget.primaryColor}
                    onChange={(e) => setWidget({ ...widget, primaryColor: e.target.value })}
                  />
                  <Input
                    value={widget.primaryColor}
                    onChange={(e) => setWidget({ ...widget, primaryColor: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="widget-logo">Custom logo URL</Label>
                <Input
                  id="widget-logo"
                  placeholder="https://example.com/logo.png"
                  value={widget.logoUrl || ''}
                  onChange={(e) => setWidget({ ...widget, logoUrl: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="widget-welcome">Welcome message</Label>
                <Input
                  id="widget-welcome"
                  value={widget.welcomeMessage}
                  onChange={(e) => setWidget({ ...widget, welcomeMessage: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="widget-placeholder">Input placeholder</Label>
                <Input
                  id="widget-placeholder"
                  value={widget.placeholder}
                  onChange={(e) => setWidget({ ...widget, placeholder: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="widget-css">Custom CSS / Tailwind Classes</Label>
                <Textarea
                  id="widget-css"
                  placeholder="e.g. rounded-xl border-blue-500 "
                  className="min-h-20 text-xs font-mono"
                  value={widget.customCss || ''}
                  onChange={(e) => setWidget({ ...widget, customCss: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Position</Label>
                <div className="grid grid-cols-2 rounded-lg border p-1">
                  <Button
                    size="sm"
                    variant={widget.position === 'bottom-left' ? 'secondary' : 'ghost'}
                    onClick={() => setWidget({ ...widget, position: 'bottom-left' })}
                  >
                    Left
                  </Button>
                  <Button
                    size="sm"
                    variant={widget.position === 'bottom-right' ? 'secondary' : 'ghost'}
                    onClick={() => setWidget({ ...widget, position: 'bottom-right' })}
                  >
                    Right
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Dark mode</Label>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">Preview in a dark palette.</p>
                  <Switch
                    checked={widget.darkMode}
                    onCheckedChange={(darkMode) => setWidget({ ...widget, darkMode })}
                  />
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <Button disabled={saving} onClick={() => void save()}>
                <Save className="size-4" /> Save appearance
              </Button>
            </div>
          </div>
        </div>

        {/* PREVIEW WIDGET SECTION */}
        <div
          className={cn(
            'flex h-full min-h-100 w-full flex-col overflow-hidden rounded-2xl border transition-all',
            widget.darkMode
              ? 'border-white/10 bg-zinc-900 text-zinc-100'
              : 'bg-white text-zinc-950',
            widget.customCss,
          )}
        >
          <div className="flex items-center gap-3 border-b px-4 py-3">
            {widget.logoUrl ? (
              <img src={widget.logoUrl} alt="Logo" className="size-6 object-contain" />
            ) : (
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: widget.primaryColor }}
              />
            )}
            <span className="text-sm font-semibold">{widget.title}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            <div className="flex w-full">
              <p
                className={cn(
                  'w-fit max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                  widget.darkMode ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-100',
                )}
              >
                {widget.welcomeMessage}
              </p>
            </div>
          </div>
          <div className="flex gap-2 border-t p-3">
            <div
              className={cn(
                'flex-1 rounded-xl border px-3 py-2 text-xs flex items-center',
                widget.darkMode ? 'border-zinc-700 text-zinc-400' : 'text-zinc-500 bg-zinc-50/50',
              )}
            >
              {widget.placeholder}
            </div>
            <span
              className="grid size-9 shrink-0 place-items-center rounded-xl text-white "
              style={{ backgroundColor: widget.primaryColor }}
            >
              <Send className="size-4" />
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Code2 className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Embed your widget</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              The widget is served by this Agent runtime and uses the saved appearance after restart
              or deployment.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-3 flex flex-wrap gap-2">
                {(
                  [
                    { id: 'javascript', label: 'JavaScript' },
                    { id: 'react', label: 'React' },
                    { id: 'api', label: 'Server API' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setEmbedTab(tab.id)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                      embedTab === tab.id
                        ? 'bg-muted text-foreground'
                        : 'border border-border text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <CodeBlock
                code={snippets[embedTab]}
                codeHiddenKey={snippets[(embedTab + 'Hidden') as keyof typeof snippets]}
                showKey={showApiKey}
                onCopy={() => void copy(snippets[embedTab])}
              />
            </div>
          </div>
          <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="widget-host">Widget server URL</Label>
              <Input
                id="widget-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="https://agent.example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="widget-class">
                Host class name{' '}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="widget-class"
                value={embedClass}
                onChange={(e) => setEmbedClass(e.target.value)}
                placeholder="fixed z-50"
              />
              <p className="text-[11px] text-muted-foreground">
                Applied to the outer mount. The chat itself remains isolated from host CSS.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="widget-key">Server API key</Label>
                <div className="flex">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Copy API key"
                    disabled={!apiKey}
                    onClick={() => void copy(apiKey, 'API key')}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="widget-key"
                  className="pl-8 font-mono text-xs"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey || 'Start the local server to create a key'}
                  readOnly
                />
              </div>
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                This key is visible to site visitors in a script tag. Use a scoped, low-privilege
                browser key or a proxy for public production embeds.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
