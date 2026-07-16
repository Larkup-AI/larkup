"use client";

import { useState, useEffect } from "react";
import { X, ArrowUpCircle } from "lucide-react";

/**
 * UpdateBanner — Universal update notification for all channels.
 *
 * Checks https://larkup.de/api/version on mount.
 * Compares with the build-time version (NEXT_PUBLIC_APP_VERSION).
 * Detects installation channel:
 *   - Tauri (window.__TAURI__) → Desktop → offers in-app update
 *   - NEXT_PUBLIC_RUNNING_IN_DOCKER → Docker → shows docker pull command
 *   - Otherwise → npm/CLI → shows npm install command
 *
 * Dismissable: stores dismissal in localStorage for 24h.
 */

const VERSION_CHECK_URL = "https://larkup.de/api/version";
const DISMISS_KEY = "larkup-update-dismissed";
const DISMISS_TTL = 24 * 60 * 60 * 1000; // 24 hours

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

type Channel = "desktop" | "docker" | "npm";

function detectChannel(): Channel {
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return "desktop";
  }
  if (process.env.NEXT_PUBLIC_RUNNING_IN_DOCKER === "true") {
    return "docker";
  }
  return "npm";
}

function isDismissed(): boolean {
  if (typeof window === "undefined") return true;
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
    localStorage.setItem(
      DISMISS_KEY,
      JSON.stringify({ timestamp: Date.now() })
    );
  } catch {
    // ignore
  }
}

export function UpdateBanner() {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [updating, setUpdating] = useState(false);

  const currentVersion =
    process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
  const channel = detectChannel();

  useEffect(() => {
    if (isDismissed()) return;

    const controller = new AbortController();

    fetch(VERSION_CHECK_URL, {
      signal: controller.signal,
      cache: "no-store",
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
    if (channel === "desktop") {
      // Trigger Tauri auto-update
      setUpdating(true);
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const { relaunch } = await import("@tauri-apps/plugin-process");

        const update = await check();
        if (update) {
          await update.downloadAndInstall();
          await relaunch();
        } else {
          setUpdating(false);
        }
      } catch (err) {
        console.error("Auto-update failed:", err);
        setUpdating(false);
        // Fall back to download page
        window.open("https://larkup.de/download", "_blank");
      }
    } else {
      // Open download page for Docker/npm users
      window.open("https://larkup.de/download", "_blank");
    }
  };

  if (!visible || !latestVersion) return null;

  return (
    <div className="relative z-50 flex items-center justify-center gap-3 bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm text-white shadow-sm">
      <ArrowUpCircle className="h-4 w-4 shrink-0" />
      <span>
        <span className="font-medium">Larkup v{latestVersion}</span> is
        available{" "}
        <span className="opacity-75">(you&apos;re on v{currentVersion})</span>
      </span>

      <button
        onClick={handleUpdate}
        disabled={updating}
        className="ml-2 rounded-full bg-white/20 px-3 py-0.5 text-xs font-medium transition-colors hover:bg-white/30 disabled:opacity-50"
      >
        {updating ? "Updating..." : channel === "desktop" ? "Update Now" : "View Details"}
      </button>

      {channel !== "desktop" && (
        <code className="hidden sm:inline rounded bg-white/10 px-2 py-0.5 text-xs font-mono">
          {channel === "docker"
            ? "docker pull aboneda/larkup:latest"
            : "npm i -g @larkup/cli"}
        </code>
      )}

      <button
        onClick={handleDismiss}
        className="ml-auto shrink-0 rounded p-0.5 transition-colors hover:bg-white/20"
        aria-label="Dismiss update notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
