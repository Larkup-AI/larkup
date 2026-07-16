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
} from "@/components/ui/select";
import { PROVIDER_META, ProviderIcon } from "@/components/ui/provider-icon";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CustomModelForm } from "@/components/configure/custom-model-modal";
import type { CustomModelConfig } from "@larkup/core/types";
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
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [view, setView] = useState<"main" | "custom">("main");
  const [customChatModels, setCustomChatModels] = useState<CustomModelConfig[]>(
    [],
  );

  useEffect(() => {
    if (config && open) {
      setProvider(config.chatProvider || config.embeddingProvider || "openai");
      setApiKey(config.chatApiKey || "");
      setSystemPrompt(config.systemPrompt || "");
      setCustomChatModels(config.customChatModels || []);
    }
    if (!open) {
      setView("main");
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
            systemPrompt: systemPrompt,
            customChatModels: customChatModels,
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

      <DialogContent className="max-w-md overflow-hidden transition-all duration-300">
        {view === "main" ? (
          <div className="flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <DialogHeader>
              <DialogTitle>Chat Provider Settings</DialogTitle>
              <DialogDescription>
                Configure the AI provider and API key used for the Chat
                interface. This can be different from your embedding provider.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSave} className="flex flex-col gap-4 mt-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">
                  AI Provider
                </label>
                <div className="flex items-center gap-2">
                  <Select
                    value={provider}
                    onValueChange={(v) => setProvider(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <span className="flex items-center gap-2">
                        {provider &&
                        PROVIDER_META[
                          provider as keyof typeof PROVIDER_META
                        ] ? (
                          <>
                            <ProviderIcon
                              src={
                                PROVIDER_META[
                                  provider as keyof typeof PROVIDER_META
                                ].iconSrc
                              }
                              alt={
                                PROVIDER_META[
                                  provider as keyof typeof PROVIDER_META
                                ].label
                              }
                              pillBg={
                                PROVIDER_META[
                                  provider as keyof typeof PROVIDER_META
                                ].pillBg
                              }
                              size={16}
                            />
                            <span>
                              {
                                PROVIDER_META[
                                  provider as keyof typeof PROVIDER_META
                                ].label
                              }
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            Select an AI Provider
                          </span>
                        )}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "vercel_ai_gateway",
                        "openai",
                        "anthropic",
                        "google",
                        "mistral",
                        "deepseek",
                        "cohere",
                        "meta",
                        "xai",
                        "perplexity",
                        "groq",
                        "together-ai",
                        "fireworks",
                        "cerebras",
                      ].map((key) => {
                        const meta =
                          PROVIDER_META[key as keyof typeof PROVIDER_META];
                        if (!meta) return null;
                        return (
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
                        );
                      })}
                      {customChatModels?.map((cfg) => (
                        <SelectItem
                          key={`custom:${cfg.modelName}`}
                          value="custom"
                        >
                          <div className="flex items-center gap-2">
                            <ProviderIcon
                              src={PROVIDER_META.custom?.iconSrc ?? ""}
                              alt="Custom"
                              pillBg={PROVIDER_META.custom?.pillBg}
                              size={16}
                            />
                            <span>{cfg.modelName} (Custom)</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <TooltipProvider delay={0}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="outline"
                            size="icon"
                            type="button"
                            onClick={() => setView("custom")}
                            className="shrink-0 h-9 w-9"
                          >
                            <Settings className="size-4 hidden" />
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="24"
                              height="24"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="lucide lucide-plus size-4"
                            >
                              <path d="M5 12h14" />
                              <path d="M12 5v14" />
                            </svg>
                          </Button>
                        }
                      />
                      <TooltipContent>Add custom chat model</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
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
                  If left blank, it falls back to{" "}
                  <code>AI_GATEWAY_API_KEY</code> or{" "}
                  <code>EMBEDDING_API_KEY</code> in your environment.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">
                  System Prompt
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Leave blank to use default system prompt"
                  className="w-full min-h-[100px] rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground">
                  Override the default instructions given to the agent.
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
          </div>
        ) : (
          <div className="flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
            <DialogHeader>
              <DialogTitle>Custom Chat Model</DialogTitle>
              <DialogDescription>
                Connect an OpenAI-compatible chat model.
              </DialogDescription>
            </DialogHeader>
            <CustomModelForm
              type="chat"
              onSave={(cfg) => {
                const next = [...customChatModels];
                const idx = next.findIndex(
                  (m) => m.modelName === cfg.modelName,
                );
                if (idx >= 0) next[idx] = cfg;
                else next.push(cfg);
                setCustomChatModels(next);
                setProvider("custom");
                setView("main");
              }}
              onCancel={() => setView("main")}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
