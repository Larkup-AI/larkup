"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { PROVIDER_META, ProviderIcon } from "@/components/ui/provider-icon";
import { useRouter } from "next/navigation";

// Only providers that have BOTH chat and embedding capabilities built-in
const DUAL_PROVIDERS = [
  "openai",
  "google",
  "mistral",
  "vercel_ai_gateway",
] as const;

export function WelcomeScreen() {
  const { setUsername, refresh } = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<string>("openai");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const handleComplete = async () => {
    setSaving(true);
    try {
      if (name.trim()) {
        await setUsername(name.trim());
      }

      // Save provider and key to config if provided
      if (provider && apiKey) {
        const configRes = await fetch("/api/config");
        const { config } = await configRes.json();

        await fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...config,
            embeddingProvider: provider,
            embeddingApiKey: apiKey,
            chatProvider: provider,
            chatApiKey: apiKey,
          }),
        });
      }

      // Mark as not first run
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFirstRun: false }),
      });

      refresh();
      router.push("/chat");
    } catch (error) {
      toast.error("Failed to complete setup");
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      if (name.trim()) {
        await setUsername(name.trim());
      }

      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFirstRun: false }),
      });

      refresh();
      router.push("/chat");
    } catch (error) {
      toast.error("Failed to complete setup");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 h-[500px] w-[500px] rounded-full bg-stone-200/40 blur-3xl animate-pulse" />
        <div className="absolute -bottom-32 -right-32 h-[600px] w-[600px] rounded-full bg-amber-100/30 blur-3xl animate-pulse [animation-delay:1s]" />
      </div>

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-8 px-6 animate-fade-up">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
            <img src="/logo9.png" className="size-6" alt="Larkup" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Welcome to Larkup
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Let's set up your AI model workspace. You can change these later
              in Settings.
            </p>
          </div>
        </div>

        <div className="w-full space-y-5 rounded-2xl border border-border bg-card/50 p-6 backdrop-blur-xl shadow-sm">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Your Name (Optional)
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="How should we call you?"
              className="bg-background/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              AI Provider
            </label>
            <Select value={provider} onValueChange={(val) => setProvider(val ?? "")}>
              <SelectTrigger className="w-full bg-background/50">
                <span className="flex items-center gap-2">
                  {PROVIDER_META[provider as keyof typeof PROVIDER_META] ? (
                    <>
                      <ProviderIcon
                        src={
                          PROVIDER_META[provider as keyof typeof PROVIDER_META]
                            .iconSrc
                        }
                        alt={
                          PROVIDER_META[provider as keyof typeof PROVIDER_META]
                            .label
                        }
                        pillBg={
                          PROVIDER_META[provider as keyof typeof PROVIDER_META]
                            .pillBg
                        }
                        size={16}
                      />
                      {
                        PROVIDER_META[provider as keyof typeof PROVIDER_META]
                          .label
                      }
                    </>
                  ) : (
                    "Select provider"
                  )}
                </span>
              </SelectTrigger>
              <SelectContent>
                {DUAL_PROVIDERS.map((key) => {
                  const meta = PROVIDER_META[key as keyof typeof PROVIDER_META];
                  if (!meta) return null;
                  return (
                    <SelectItem key={key} value={key}>
                      <div className="flex items-center gap-2">
                        <ProviderIcon
                          src={meta.iconSrc}
                          alt={meta.label}
                          pillBg={meta.pillBg}
                          size={16}
                        />
                        <span>
                          {meta.label}
                          {key === "vercel_ai_gateway" && " (Recommended)"}
                        </span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground pt-1">
              Showing providers that support both chat and embeddings. More
              available in Settings.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              API Key
            </label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="bg-background/50"
            />
          </div>

          <div className="pt-2 flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleSkip}
              disabled={saving}
            >
              Skip for now
            </Button>
            <Button
              className="flex-1"
              onClick={handleComplete}
              disabled={saving || (!apiKey && provider !== "vercel_ai_gateway")}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  Continue <ArrowRight className="ml-1.5 size-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
