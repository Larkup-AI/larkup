'use client';

import { useRef, useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  ExternalLink,
  Globe,
  Eye,
  EyeOff,
  Terminal,
  Server,
  CheckCircle,
  CircleCheck,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useVpsTerminalStore } from '@/store/deploy-store';

// Password-change dialog.

interface PasswordChangeDialogProps {
  open: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

function PasswordChangeDialog({ open, onSubmit, onCancel }: PasswordChangeDialogProps) {
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = () => {
    if (!newPass) {
      toast.error('Enter a new password.', { position: 'bottom-left' });
      return;
    }
    if (newPass !== confirmPass) {
      toast.error('Passwords do not match.', { position: 'bottom-left' });
      return;
    }
    if (newPass.length < 8) {
      toast.error('Password must be at least 8 characters.', { position: 'bottom-left' });
      return;
    }
    onSubmit(newPass);
    setNewPass('');
    setConfirmPass('');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <Server className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <DialogTitle>Password Change Required</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Your server requires a password change on first login.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <p className="text-xs text-muted-foreground rounded-lg bg-muted/50 p-3 border">
            This is common for first-time logins on Hetzner, AWS EC2, DigitalOcean, and similar
            providers. Your chosen password will be used to continue deployment.
          </p>
          <div className="grid gap-2">
            <Label>New Password</Label>
            <div className="relative">
              <Input
                type={showNew ? 'text' : 'password'}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="Enter new root password"
                className="pr-10"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Confirm Password</Label>
            <div className="relative">
              <Input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                placeholder="Re-enter new password"
                className="pr-10"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSubmit}>
              Change & Deploy
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Success screen.

interface SuccessScreenProps {
  url: string;
  targetLabel: string;
  onViewDeployment: () => void;
}

function SuccessScreen({ url, targetLabel, onViewDeployment }: SuccessScreenProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col items-center gap-6 py-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600  border-green-700 dark:bg-emerald-900/30 ring-4 ring-emerald-50 dark:ring-emerald-900/10">
        <Check className="h-8 w-8 text-white" />
      </div>

      <div>
        <h3 className="text-xl font-semibold tracking-tight">Agent is Live!</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Your {targetLabel} server is running and ready to receive requests.
        </p>
      </div>

      <div className="w-full rounded-xl border bg-muted/30 p-4 space-y-2">
        <p className="text-xs font-medium text-muted-foreground text-left">SERVER ENDPOINT</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-background border px-3 py-2 text-sm font-mono">
            {url}
          </code>
          <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={handleCopy}>
            {copied ? (
              <CheckCircle2 className="size-3.5 text-emerald-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => window.open(url, '_blank')}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="w-full rounded-xl border border-dashed bg-muted/10 p-4 text-left space-y-2">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">Want a custom domain?</p>
        </div>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside pl-1">
          <li>
            Point your domain&apos;s <strong>A record</strong> to the server IP.
          </li>
          <li>
            SSH in and install <strong>nginx + certbot</strong> for HTTPS/SSL.
          </li>
          <li>
            Or use <strong>Cloudflare proxy</strong> (free SSL, no nginx needed).
          </li>
        </ol>
        <p className="text-[10px] text-muted-foreground/70 italic pt-1">
          Full automated custom domain setup is coming in a future release.
        </p>
      </div>

      <Button className="w-full" onClick={onViewDeployment}>
        View Deployment
      </Button>
    </div>
  );
}

function TerminalPanel({ logs, isLive }: { logs: string[]; isLive: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="relative flex flex-col aspect-video w-full rounded-xl overflow-hidden border border-zinc-700 bg-[#0d0d0d]">
      <div className="flex shrink-0 items-center gap-1.5 px-3 py-2 border-b border-zinc-800 bg-zinc-900">
        <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
        <div className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
        <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
        <Terminal className="ml-2 size-3 text-zinc-500" />
        <span className="ml-1 text-[10px] font-medium text-zinc-500">larkup — deploy</span>
        {isLive && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            Live
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
        {logs.length === 0 ? (
          <span className="text-zinc-600">Initialising...</span>
        ) : (
          logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              <span className="text-zinc-600 select-none mr-2">$</span>
              <span
                className={
                  line.startsWith('✓') ||
                  line.toLowerCase().includes('connected') ||
                  line.toLowerCase().includes('live')
                    ? 'text-emerald-400'
                    : line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')
                    ? 'text-red-400'
                    : line.startsWith('$')
                    ? 'text-cyan-400'
                    : line.startsWith('---')
                    ? 'text-amber-400'
                    : 'text-zinc-300'
                }
              >
                {line}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// Main dialog.

export interface VpsTerminalDialogProps {
  /** Display name of the target provider (e.g. "DigitalOcean"). */
  targetLabel: string;
  /** Called with the new password when the server requires a change on first login. */
  onPasswordSubmit: (newPassword: string) => void;
  /** Called when the user closes after success or error. */
  onClose: () => void;
  /** Called when the user clicks "View Deployment" on the success screen. */
  onViewDeployment: () => void;
}

/**
 * Reads all runtime state from the Zustand VPS terminal store.
 * The parent only needs to provide callbacks and the target label.
 */
export function VpsTerminalDialog({
  targetLabel,
  onPasswordSubmit,
  onClose,
  onViewDeployment,
}: VpsTerminalDialogProps) {
  const { open, logs, state, url, error } = useVpsTerminalStore();

  const isSuccess = state === 'success';
  const isError = state === 'error';
  const isPasswordRequired = state === 'password_required';
  const isDeploying = state === 'deploying';

  const statusLabel = isDeploying
    ? `Setting up ${targetLabel} server...`
    : isError
    ? 'Deployment failed'
    : isSuccess
    ? 'Deployment complete'
    : 'Action required';

  return (
    <>
      <PasswordChangeDialog
        open={isPasswordRequired}
        onSubmit={onPasswordSubmit}
        onCancel={onClose}
      />

      <Dialog
        open={open && !isPasswordRequired}
        onOpenChange={(v) => !v && !isDeploying && onClose()}
      >
        <DialogContent className="sm:max-w-3xl ">
          {isSuccess && url ? (
            <SuccessScreen
              url={url}
              targetLabel={targetLabel}
              onViewDeployment={onViewDeployment}
            />
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 mb-1">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                      isError ? 'bg-red-100 dark:bg-red-900/30' : 'bg-zinc-100 dark:bg-zinc-800'
                    }`}
                  >
                    {isDeploying ? (
                      <Loader2 className="h-5 w-5 animate-spin text-zinc-600 dark:text-zinc-400" />
                    ) : isError ? (
                      <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                    ) : (
                      <Terminal className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                    )}
                  </div>
                  <div>
                    <DialogTitle>{statusLabel}</DialogTitle>
                    <DialogDescription className="text-xs mt-0.5">
                      {isDeploying
                        ? `Larkup is automatically configuring your ${targetLabel} server. This may take a few minutes.`
                        : isError
                        ? 'The deployment encountered an error. Check the logs below for details.'
                        : ''}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <TerminalPanel logs={logs} isLive={isDeploying} />

              {isError && error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 px-3 py-2">
                  <p className="text-xs font-medium text-red-700 dark:text-red-400">{error}</p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <Button
                  variant={isError ? 'default' : 'outline'}
                  size="sm"
                  onClick={onClose}
                  disabled={isDeploying}
                >
                  {isError ? 'Close' : 'Cancel'}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
