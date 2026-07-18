"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "@/lib/error-formatter";
import {
  ExternalLink,
  Loader2,
  CheckCircle2,
  Database,
  FileText,
  RefreshCw,
  Link2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface NotionPage {
  id: string;
  title: string;
  icon: string | null;
  url: string;
  lastEdited: string;
  parentType: string;
}

interface NotionDatabase {
  id: string;
  title: string;
  icon: string | null;
  url: string;
  lastEdited: string;
  type: "database";
}

interface NotionStatus {
  connected: boolean;
  configured: boolean;
  pages: NotionPage[];
  databases?: NotionDatabase[];
  error?: string;
}

export function NotionPanel({ onAdded }: { onAdded: () => void }) {
  const [status, setStatus] = useState<NotionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [showType, setShowType] = useState<"all" | "pages" | "databases">("all");

  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    setLoading(true);
    try {
      const res = await fetch("/api/notion");
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      setStatus({
        connected: false,
        configured: false,
        pages: [],
        error: formatErrorMessage(err),
      });
    } finally {
      setLoading(false);
    }
  }

  function connectNotion() {
    const clientId = status?.configured
      ? undefined
      : prompt("Enter your Notion Client ID (from notion.so/my-integrations):");

    if (!status?.configured && !clientId) return;

    // For OAuth flow, redirect to Notion authorization
    const notionClientId = clientId || process.env.NEXT_PUBLIC_NOTION_CLIENT_ID;
    if (!notionClientId) {
      toast.error(
        "Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET in your .env file, then restart the server.",
      );
      return;
    }

    const redirectUri = `${window.location.origin}/api/notion/callback`;
    const authUrl = `https://api.notion.com/v1/oauth/authorize?client_id=${notionClientId}&response_type=code&owner=user&redirect_uri=${encodeURIComponent(redirectUri)}`;
    window.location.href = authUrl;
  }

  function togglePage(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(items: { id: string }[]) {
    const allSelected = items.every((p) => selected.has(p.id));
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        items.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        items.forEach((p) => next.add(p.id));
        return next;
      });
    }
  }

  async function importSelected() {
    if (selected.size === 0) {
      toast.error("Select at least one page to import.");
      return;
    }

    setImporting(true);
    try {
      const res = await fetch("/api/notion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageIds: Array.from(selected) }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Import failed");

      toast.success(
        `${data.imported} of ${data.total} page${data.total !== 1 ? "s" : ""} imported successfully`,
      );
      setSelected(new Set());
      onAdded();
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Checking Notion connection…
        </p>
      </div>
    );
  }

  // Not connected state
  if (!status?.connected) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <img src="/notion.png" alt="Notion" className="size-6 opacity-60" />
        </div>
        <div className="text-center max-w-md">
          <h3 className="text-lg font-semibold text-foreground">
            Connect Notion
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
            Import pages and databases from your Notion workspace directly into
            your knowledge base.
          </p>

          {status?.error && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              {status.error}
            </div>
          )}

          <div className="mt-4 space-y-3">
            {!status?.configured ? (
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-left space-y-2.5">
                <p className="text-xs font-medium text-foreground">
                  Setup required:
                </p>
                <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal ml-4">
                  <li>
                    Go to{" "}
                    <a
                      href="https://www.notion.so/my-integrations"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-0.5"
                    >
                      notion.so/my-integrations
                      <ExternalLink className="size-2.5" />
                    </a>
                  </li>
                  <li>Create a new <strong>Public</strong> integration</li>
                  <li>
                    Set redirect URI to:{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono">
                      {typeof window !== "undefined"
                        ? `${window.location.origin}/api/notion/callback`
                        : "/api/notion/callback"}
                    </code>
                  </li>
                  <li>
                    Add <code className="rounded bg-muted px-1 font-mono text-[10px]">NOTION_CLIENT_ID</code>{" "}
                    and{" "}
                    <code className="rounded bg-muted px-1 font-mono text-[10px]">NOTION_CLIENT_SECRET</code>{" "}
                    to your <code className="rounded bg-muted px-1 font-mono text-[10px]">.env</code>
                  </li>
                  <li>Restart the server and click Connect below</li>
                </ol>
              </div>
            ) : null}

            <Button onClick={connectNotion} className="gap-2">
              <Link2 className="size-4" />
              {status?.configured
                ? "Connect Notion Account"
                : "I've Set Up My Integration — Connect"}
            </Button>

            {!status?.configured && (
              <p className="text-[10px] text-muted-foreground/70">
                Or set <code className="font-mono">NOTION_ACCESS_TOKEN</code> directly in .env for internal integrations.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Connected — show pages
  const allPages = status.pages || [];
  const allDatabases = status.databases || [];
  const query = search.toLowerCase().trim();

  const filteredPages = query
    ? allPages.filter((p) => p.title.toLowerCase().includes(query))
    : allPages;

  const filteredDatabases = query
    ? allDatabases.filter((d) => d.title.toLowerCase().includes(query))
    : allDatabases;

  const visibleItems =
    showType === "pages"
      ? filteredPages
      : showType === "databases"
        ? filteredDatabases
        : [...filteredPages, ...filteredDatabases];

  return (
    <div className="space-y-4">
      {/* Connection status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-green-600" />
          <span className="text-sm font-medium text-foreground">
            Notion Connected
          </span>
          <Badge variant="outline" className="text-[10px]">
            {allPages.length} pages · {allDatabases.length} databases
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchStatus}
          className="h-7 gap-1.5 text-xs"
        >
          <RefreshCw className="size-3" />
          Refresh
        </Button>
      </div>

      {/* Search + filter */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search pages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        <div className="flex items-center rounded-lg border border-border p-0.5">
          {(["all", "pages", "databases"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setShowType(t)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors capitalize",
                showType === t
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Pages list */}
      {visibleItems.length > 0 ? (
        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {visibleItems.length} item{visibleItems.length !== 1 ? "s" : ""} ·{" "}
              {selected.size} selected
            </span>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => toggleAll(visibleItems)}
            >
              {visibleItems.every((p) => selected.has(p.id))
                ? "Clear all"
                : "Select all"}
            </button>
          </div>
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {visibleItems.map((item) => {
              const checked = selected.has(item.id);
              const isDb = "type" in item && item.type === "database";
              return (
                <li key={item.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50",
                      checked && "bg-accent/50",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => togglePage(item.id)}
                    />
                    <span className="text-base">
                      {item.icon || (isDb ? "📊" : "📄")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {item.title}
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        {isDb ? (
                          <Database className="size-2.5" />
                        ) : (
                          <FileText className="size-2.5" />
                        )}
                        {isDb ? "Database" : "Page"}
                        {item.lastEdited && (
                          <>
                            <span>·</span>
                            {new Date(item.lastEdited).toLocaleDateString()}
                          </>
                        )}
                      </span>
                    </div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {search
              ? "No pages match your search."
              : "No pages found. Make sure your integration has access to pages in Notion."}
          </p>
        </div>
      )}

      {/* Import button */}
      {selected.size > 0 && (
        <Button
          onClick={importSelected}
          disabled={importing}
          className="w-full"
        >
          {importing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <img src="/notion.png" alt="Notion" className="size-4" />
          )}
          Import {selected.size} page{selected.size !== 1 ? "s" : ""}
        </Button>
      )}
    </div>
  );
}
