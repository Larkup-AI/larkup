'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Link2,
  Loader2,
  Radio,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/** Mirrors the payload of GET /api/agents/:id/channels. */
interface ChannelConfigField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'url' | 'boolean';
  required: boolean;
  placeholder?: string;
  help?: string;
}

interface ChannelView {
  id: string;
  name: string;
  description: string;
  configFields: ChannelConfigField[];
  supportsRegistration: boolean;
  webhookUrl: string;
  enabled: boolean;
  settings: Record<string, string>;
  lastInboundAt?: string;
  lastErrorAt?: string;
  lastError?: string;
}

interface HealthView {
  status: 'ok' | 'misconfigured' | 'unreachable';
  detail: string;
  identity?: string;
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex gap-2">
      <Input readOnly value={value} className="h-8 font-mono text-[11px]" />
      <Button
        variant="outline"
        size="sm"
        className="h-8 shrink-0 gap-1.5 text-xs"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            toast.error('Could not copy — select the field and copy manually.');
          }
        }}
      >
        {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function HealthBadge({ health }: { health: HealthView | null }) {
  if (!health) return null;

  const Icon =
    health.status === 'ok'
      ? CheckCircle2
      : health.status === 'misconfigured'
      ? AlertTriangle
      : XCircle;
  const tone =
    health.status === 'ok'
      ? 'text-green-600 dark:text-green-400'
      : health.status === 'misconfigured'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-destructive';

  return (
    <div className={`flex items-center gap-1.5 text-xs ${tone}`}>
      <Icon className="size-3.5 shrink-0" />
      <span>{health.detail}</span>
    </div>
  );
}

function ChannelCard({
  agentId,
  channel,
  onSaved,
}: {
  agentId: string;
  channel: ChannelView;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(channel.enabled);
  const [settings, setSettings] = useState<Record<string, string>>(channel.settings);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [health, setHealth] = useState<HealthView | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function save() {
    setSaving(true);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/agents/${agentId}/channels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channel.id, enabled, settings }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.fields) setFieldErrors(body.fields);
        throw new Error(body.error ?? 'Save failed');
      }
      setSettings(body.settings ?? settings);
      toast.success(`${channel.name} ${enabled ? 'enabled' : 'disabled'}.`);
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function checkHealth() {
    setChecking(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/channels/${channel.id}/health`);
      setHealth(await res.json());
    } catch {
      setHealth({ status: 'unreachable', detail: 'Could not run the health check.' });
    } finally {
      setChecking(false);
    }
  }

  async function register() {
    setRegistering(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/channels/${channel.id}/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.detail ?? 'Registration failed');
      toast.success(body.detail);
      await checkHealth();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Radio className="size-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">{channel.name}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{channel.description}</p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label={`Enable ${channel.name}`}
        />
      </div>

      {enabled && (
        <>
          <div className="grid gap-3">
            {channel.configFields.map((field) => (
              <div key={field.key} className="grid gap-1.5">
                <Label className="text-xs">
                  {field.label}
                  {field.required && <span className="ml-1 text-destructive">*</span>}
                </Label>
                <Input
                  className="h-8 text-xs"
                  type={field.type === 'secret' ? 'password' : 'text'}
                  placeholder={field.placeholder}
                  value={settings[field.key] ?? ''}
                  onChange={(e) => setSettings({ ...settings, [field.key]: e.target.value })}
                  aria-invalid={Boolean(fieldErrors[field.key])}
                />
                {fieldErrors[field.key] ? (
                  <p className="text-[11px] text-destructive">{fieldErrors[field.key]}</p>
                ) : (
                  field.help && <p className="text-[11px] text-muted-foreground">{field.help}</p>
                )}
              </div>
            ))}
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Webhook URL</Label>
            <CopyField value={channel.webhookUrl} />
            <p className="text-[11px] text-muted-foreground">
              {channel.supportsRegistration
                ? 'Save first, then use Register to point the provider at this URL. It must be publicly reachable.'
                : 'Point your system at this URL. Requests must be signed with the secret above.'}
            </p>
          </div>

          <HealthBadge health={health} />

          {channel.lastError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px]">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-destructive" />
              <span>
                Last delivery failed
                {channel.lastErrorAt &&
                  ` at ${new Date(channel.lastErrorAt).toLocaleString()}`}: {channel.lastError}
              </span>
            </div>
          )}
          {!channel.lastError && channel.lastInboundAt && (
            <p className="text-[11px] text-muted-foreground">
              Last message answered {new Date(channel.lastInboundAt).toLocaleString()}.
            </p>
          )}
        </>
      )}

      <div className="flex items-center justify-end gap-2">
        {enabled && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => void checkHealth()}
              disabled={checking}
            >
              {checking ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              Test connection
            </Button>
            {channel.supportsRegistration && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => void register()}
                disabled={registering}
              >
                <Link2 className="size-3" />
                {registering ? 'Registering…' : 'Register webhook'}
              </Button>
            )}
          </>
        )}
        <Button size="sm" className="h-7 text-xs" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

export function AgentChannelsDialog({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<ChannelView[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/channels`);
      if (!res.ok) throw new Error((await res.json()).error);
      setChannels((await res.json()).channels ?? []);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load channels');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground">
            <Radio className="size-3" />
            Channels
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Channels — {agentName}</DialogTitle>
          <DialogDescription>
            Answer messages from outside the dashboard. Every inbound request is verified before the
            agent runs, and credentials stay on the server.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading channels…
          </div>
        ) : (
          <div className="grid gap-3 py-1">
            {channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                agentId={agentId}
                channel={channel}
                onSaved={() => void load()}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
