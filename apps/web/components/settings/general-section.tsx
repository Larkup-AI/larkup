"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { RagConfig } from "@larkup/core/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { useWorkspace } from "@/components/workspace/workspace-provider";

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

export function GeneralSection() {
  const { data, isLoading, mutate } = useSWR("/api/config", fetcher);
  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const { username, setUsername } = useWorkspace();
  const [localName, setLocalName] = useState(username || "");

  useEffect(() => {
    if (data?.config) setForm(data.config);
  }, [data]);

  useEffect(() => {
    if (username && localName !== username) setLocalName(username);
  }, [username]);

  const dirtyUsername = localName.trim() !== (username || "");
  const dirtyWebSearch = form.serperApiKey !== data?.config?.serperApiKey;
  const dirtyScraper =
    form.scraperProxyServer !== data?.config?.scraperProxyServer ||
    form.scraperProxyUsername !== data?.config?.scraperProxyUsername ||
    form.scraperProxyPassword !== data?.config?.scraperProxyPassword ||
    form.firecrawlApiKey !== data?.config?.firecrawlApiKey;

  async function handleSave(section: "username" | "webSearch" | "scraper") {
    setSaving(section);
    try {
      let payload = { ...data?.config };

      if (section === "username") {
        if (localName.trim() && localName.trim() !== username) {
          await setUsername(localName.trim());
        }
        setSaving(null);
        toast.success("Settings saved");
        return;
      } else if (section === "webSearch") {
        payload.serperApiKey = form.serperApiKey;
      } else if (section === "scraper") {
        payload.scraperProxyServer = form.scraperProxyServer;
        payload.scraperProxyUsername = form.scraperProxyUsername;
        payload.scraperProxyPassword = form.scraperProxyPassword;
        payload.firecrawlApiKey = form.firecrawlApiKey;
      }

      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");

      setForm((prev) => ({ ...prev, ...json.config }));
      await mutate(json, { revalidate: false });
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
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
          <h2 className="text-lg font-semibold tracking-tight">General</h2>
          <p className="text-sm text-muted-foreground">
            Workspace and integration settings.
          </p>
        </div>
      </div>

      {/* Username */}
      <Card className="">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Your Name</CardTitle>
          <CardDescription className="text-xs">
            Displayed in the workspace header.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder="Enter your name"
            className=""
          />
        </CardContent>
        <CardFooter className="flex justify-end pt-4 border-t">
          <Button
            size="sm"
            disabled={saving === "username" || !dirtyUsername}
            onClick={() => handleSave("username")}
            className="gap-1.5"
          >
            {saving === "username" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </CardFooter>
      </Card>

      {/* Web Search */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Web Search</CardTitle>
          <CardDescription className="text-xs">
            Enable AI-powered web search for enriched answers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Serper.dev API Key</Label>
            <Input
              type="password"
              className="text-sm"
              value={form.serperApiKey || ""}
              onChange={(e) =>
                setForm({ ...form, serperApiKey: e.target.value })
              }
              placeholder="Your Serper API Key"
            />
          </div>
        </CardContent>
        <CardFooter className="flex justify-end pt-4 border-t">
          <Button
            size="sm"
            disabled={saving === "webSearch" || !dirtyWebSearch}
            onClick={() => handleSave("webSearch")}
            className="gap-1.5"
          >
            {saving === "webSearch" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </CardFooter>
      </Card>

      {/* Scraper */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Web Scraper</CardTitle>
          <CardDescription className="text-xs">
            Configure proxy and scraping settings for data collection.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Proxy Server</Label>
            <Input
              className="text-sm"
              value={form.scraperProxyServer || ""}
              onChange={(e) =>
                setForm({ ...form, scraperProxyServer: e.target.value })
              }
              placeholder="http://proxy.example.com:8080"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Proxy Username</Label>
              <Input
                className="text-sm"
                value={form.scraperProxyUsername || ""}
                onChange={(e) =>
                  setForm({ ...form, scraperProxyUsername: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Proxy Password</Label>
              <Input
                type="password"
                className="text-sm"
                value={form.scraperProxyPassword || ""}
                onChange={(e) =>
                  setForm({ ...form, scraperProxyPassword: e.target.value })
                }
              />
            </div>
          </div>
          <div className="space-y-1.5 pt-2">
            <Label className="text-xs">Firecrawl API Key (Cloud)</Label>
            <Input
              type="password"
              className="text-sm"
              value={form.firecrawlApiKey || ""}
              onChange={(e) =>
                setForm({ ...form, firecrawlApiKey: e.target.value })
              }
              placeholder="fc-..."
            />
          </div>
        </CardContent>
        <CardFooter className="flex justify-end pt-4 border-t">
          <Button
            size="sm"
            disabled={saving === "scraper" || !dirtyScraper}
            onClick={() => handleSave("scraper")}
            className="gap-1.5"
          >
            {saving === "scraper" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
