'use client';

import { useState, useEffect } from 'react';
import { ArrowUp, Check, Copy, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * UpdateBanner, Universal update notification for all channels.
 */

const VERSION_CHECK_URL = 'https://larkup.de/api/version';
const DISMISS_KEY = 'larkup-update-dismissed';
const DISMISS_TTL = 24 * 60 * 60 * 1000; // 24 hours

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

type Channel = 'desktop' | 'docker' | 'npm';

function detectChannel(): Channel {
  if (typeof window !== 'undefined' && '__TAURI__' in window) {
    return 'desktop';
  }
  if (
    process.env.NEXT_PUBLIC_DOCKER_ENV === 'true' ||
    process.env.NEXT_PUBLIC_RUNNING_IN_DOCKER === 'true'
  ) {
    return 'docker';
  }
  return 'npm';
}

const UPDATE_COMMANDS: Record<Exclude<Channel, 'desktop'>, string> = {
  docker: 'docker compose pull && docker compose up -d',
  npm: 'larkup update',
};

function isDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const data = localStorage.getItem(DISMISS_KEY);
    if (!data) return false;
    const { timestamp } = JSON.parse(data);
    return Date.now() - timestamp < DISMISS_TTL;
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify({ timestamp: Date.now() }));
  } catch {
    // ignore
  }
}

export function UpdateBanner() {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [copied, setCopied] = useState(false);

  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';
  const channel = detectChannel();

  useEffect(() => {
    if (isDismissed()) return;

    const controller = new AbortController();

    fetch(VERSION_CHECK_URL, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.version && compareVersions(data.version, currentVersion) > 0) {
          setLatestVersion(data.version);
          setVisible(true);
        }
      })
      .catch(() => {
        // Silently fail — update check is non-critical
      });

    return () => controller.abort();
  }, [currentVersion]);

  const handleDismiss = () => {
    dismiss();
    setVisible(false);
  };

  const handleUpdate = async () => {
    if (channel === 'desktop') {
      // Trigger Tauri auto-update
      setUpdating(true);
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const { relaunch } = await import('@tauri-apps/plugin-process');

        const update = await check();
        if (update) {
          await update.downloadAndInstall();
          await relaunch();
        } else {
          setUpdating(false);
        }
      } catch (err) {
        console.error('Auto-update failed:', err);
        setUpdating(false);
        // Fall back to download page
        window.open('https://larkup.de/download', '_blank');
      }
    } else {
      try {
        await navigator.clipboard.writeText(UPDATE_COMMANDS[channel]);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Could not copy update command:', err);
      }
    }
  };

  if (!visible || !latestVersion) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative z-50 border-b border-border bg-background px-3 py-2 text-foreground sm:px-4"
    >
      <div className="mx-auto flex min-h-7 max-w-screen-2xl items-center gap-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
          <ArrowUp className="size-3.5" aria-hidden="true" />
        </span>

        <p className="min-w-0 text-xs sm:text-sm">
          <span className="font-medium">Larkup v{latestVersion} is available.</span>{' '}
          <span className="hidden text-muted-foreground sm:inline">
            You&apos;re using v{currentVersion}.
          </span>
        </p>

        {channel !== 'desktop' && (
          <code className="ml-auto hidden max-w-[38rem] truncate rounded-[5px] border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground lg:block">
            {UPDATE_COMMANDS[channel]}
          </code>
        )}

        <Button
          type="button"
          variant={channel === 'desktop' ? 'default' : 'outline'}
          size="xs"
          onClick={handleUpdate}
          disabled={updating}
          aria-label={channel === 'desktop' ? 'Update Larkup now' : 'Copy update command'}
          className={channel === 'desktop' ? 'ml-auto' : 'ml-auto lg:ml-0'}
        >
          {channel === 'desktop' ? (
            updating ? (
              'Updating...'
            ) : (
              'Update now'
            )
          ) : copied ? (
            <>
              <Check aria-hidden="true" />
              Copied
            </>
          ) : (
            <>
              <Copy aria-hidden="true" />
              Copy command
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={handleDismiss}
          aria-label="Dismiss update notification"
          title="Remind me tomorrow"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
