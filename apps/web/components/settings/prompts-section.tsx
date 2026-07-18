"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { RagConfig } from "@larkup/core/types";

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

export function PromptsSection() {
  const { activeServer } = useWorkspace();
  const serverId = activeServer?.id;
  const configUrl = serverId
    ? `/api/config?serverId=${encodeURIComponent(serverId)}`
    : "/api/config";
  const { data, isLoading, mutate } = useSWR(configUrl, fetcher);
  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.config) setForm(data.config);
  }, [data]);

  const dirty = (form.systemPrompt || "") !== (data?.config?.systemPrompt || "");

  async function handleSave() {
    setSaving(true);
    try {
      const merged = { ...data?.config, ...form };
      const res = await fetch(configUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      await mutate(json, { revalidate: false });
      toast.success("Prompt saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
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
          <h2 className="text-lg font-semibold tracking-tight">Prompts</h2>
          <p className="text-sm text-muted-foreground">
            Customize the instructions given to your AI assistant.
          </p>
        </div>
        <Button
          size="sm"
          disabled={saving || !dirty}
          onClick={handleSave}
          className="gap-1.5"
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Save
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">System Prompt</CardTitle>
          <CardDescription className="text-xs">
            Override the default instructions given to the AI. Leave blank for the default behavior.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            value={form.systemPrompt || ""}
            onChange={(e) =>
              setForm({ ...form, systemPrompt: e.target.value })
            }
            placeholder="You are a helpful research assistant..."
            rows={8}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary resize-y min-h-[120px]"
          />
        </CardContent>
      </Card>
    </div>
  );
}
