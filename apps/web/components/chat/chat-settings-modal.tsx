"use client";

import { useState, useEffect } from "react";
import { Settings, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import useSWR from "swr";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROVIDER_META, ProviderIcon } from "@/components/ui/provider-icon";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "../ui/dialog";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function ChatSettingsModal() {
  const [open, setOpen] = useState(false);
  const { activeServer } = useWorkspace();
  const serverId = activeServer?.id;

  const { data: configData, mutate } = useSWR(
    serverId ? `/api/config?serverId=${encodeURIComponent(serverId)}` : null,
    fetcher,
  );
  
  const config = configData?.config;

  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (config && open) {
      setProvider(config.chatProvider || config.embeddingProvider || "openai");
      setApiKey(config.chatApiKey || "");
    }
  }, [config, open]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!serverId || !config) return;

    setIsSaving(true);
    try {
      const res = await fetch(
        `/api/config?serverId=${encodeURIComponent(serverId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...config,
            chatProvider: provider,
            chatApiKey: apiKey,
          }),
        },
      );

      if (!res.ok) throw new Error("Failed to save settings");

      toast.success("Chat settings saved.");
      mutate();
      setOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Error saving settings");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            title="Chat Settings"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </button>
        }
      />

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Chat Provider Settings</DialogTitle>
          <DialogDescription>
            Configure the AI provider and API key used for the Chat interface.
            This can be different from your embedding provider.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">
              AI Provider
            </label>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select an AI Provider" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROVIDER_META).map(([key, meta]) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex items-center gap-2">
                      <ProviderIcon
                        src={meta.iconSrc}
                        alt={meta.label}
                        pillBg={meta.pillBg}
                        size={18}
                      />
                      <span>{meta.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">
              API Key
            </label>
            <div className="relative flex items-center">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Leave blank to use environment variable"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 pr-10 text-sm text-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              If left blank, it falls back to <code>AI_GATEWAY_API_KEY</code> or{" "}
              <code>EMBEDDING_API_KEY</code> in your environment.
            </p>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose
              render={
                <button
                  type="button"
                  className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  Cancel
                </button>
              }
            />

            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save Settings"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
