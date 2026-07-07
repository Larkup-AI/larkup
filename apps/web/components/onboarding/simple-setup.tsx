"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Cloud,
  Eye,
  EyeOff,
  Loader2,
  Monitor,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { PROVIDER_META, ProviderIcon } from "@/components/ui/provider-icon";
import type { EmbeddingProvider } from "@larkup-rag/core/types";
import { cn } from "@/lib/utils";

interface SimpleSetupProps {
  onBack: () => void;
}

type ConnectionMode = "cloud" | "custom";

/** Ordered provider list — only Vercel AI Gateway is recommended. */
const CLOUD_PROVIDERS: { key: EmbeddingProvider; recommended?: boolean }[] = [
  { key: "vercel_ai_gateway", recommended: true },
  { key: "openai" },
  { key: "google" },
  { key: "mistral" },
  { key: "voyage" },
  { key: "jina" },
  { key: "nomic" },
  { key: "deepseek" },
];

/**
 * Default embedding model IDs for each provider.
 * OpenAI and Vercel AI Gateway get the large model; others get the first in the registry.
 */
const DEFAULT_EMBEDDING_MODEL: Partial<Record<EmbeddingProvider, string>> = {
  openai: "openai/text-embedding-3-large",
  vercel_ai_gateway: "openai/text-embedding-3-large",
  google: "google/text-embedding-004",
  mistral: "mistral/mistral-embed",
  voyage: "voyage/voyage-3",
  jina: "jina/jina-embeddings-v3",
  nomic: "nomic/nomic-embed-text-v1.5",
  deepseek: "openai/text-embedding-3-large",
};

export function SimpleSetup({ onBack }: SimpleSetupProps) {
  const { createServer, setMode } = useWorkspace();

  // Connection mode
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("cloud");

  // Cloud mode state
  const [provider, setProvider] = useState<EmbeddingProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [cloudVerified, setCloudVerified] = useState(false);
  const [testingCloud, setTestingCloud] = useState(false);

  // Custom model state
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState(
    "http://localhost:11434/v1",
  );
  const [embeddingModelName, setEmbeddingModelName] = useState("");
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [showEmbeddingApiKey, setShowEmbeddingApiKey] = useState(false);
  const [llmBaseUrl, setLlmBaseUrl] = useState("http://localhost:11434/v1");
  const [llmModelName, setLlmModelName] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [showLlmApiKey, setShowLlmApiKey] = useState(false);

  const [busy, setBusy] = useState(false);
  const [testingEmbedding, setTestingEmbedding] = useState(false);
  const [embeddingVerified, setEmbeddingVerified] = useState(false);
  const [detectedDims, setDetectedDims] = useState<number | null>(null);

  const [testingLlm, setTestingLlm] = useState(false);
  const [llmVerified, setLlmVerified] = useState(false);

  // Reset cloud verification when provider or key changes
  function onProviderChange(p: EmbeddingProvider) {
    setProvider(p);
    setCloudVerified(false);
  }
  function onApiKeyChange(v: string) {
    setApiKey(v);
    setCloudVerified(false);
  }

  async function testCloudProvider() {
    if (!apiKey.trim()) {
      toast.error("Please enter your API key first.");
      return;
    }
    setTestingCloud(true);
    try {
      const embeddingModelId =
        DEFAULT_EMBEDDING_MODEL[provider] ?? "openai/text-embedding-3-large";
      const res = await fetch("/api/config/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeddingProvider: provider,
          embeddingApiKey: apiKey,
          embeddingModelId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed");
      setCloudVerified(true);
      toast.success("API key verified successfully!");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Invalid API key. Please check and try again.",
      );
      setCloudVerified(false);
    } finally {
      setTestingCloud(false);
    }
  }

  async function testCustomEmbedding() {
    if (!embeddingBaseUrl || !embeddingModelName) {
      toast.error("Base URL and model name are required.");
      return;
    }
    setTestingEmbedding(true);
    try {
      const res = await fetch("/api/config/test-embedding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: embeddingBaseUrl,
          apiKey: embeddingApiKey || undefined,
          modelName: embeddingModelName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed");
      setDetectedDims(data.dimensions);
      setEmbeddingVerified(true);
      toast.success(`Connected! Detected ${data.dimensions} dimensions.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
      setEmbeddingVerified(false);
      setDetectedDims(null);
    } finally {
      setTestingEmbedding(false);
    }
  }

  async function testCustomLlm() {
    if (!llmBaseUrl || !llmModelName) {
      toast.error("Base URL and model name are required.");
      return;
    }
    setTestingLlm(true);
    try {
      const res = await fetch("/api/config/test-llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: llmBaseUrl,
          apiKey: llmApiKey || undefined,
          modelName: llmModelName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed");
      setLlmVerified(true);
      toast.success("LLM connected successfully!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
      setLlmVerified(false);
    } finally {
      setTestingLlm(false);
    }
  }

  async function handleFinish() {
    // Validate cloud mode
    if (connectionMode === "cloud") {
      if (!apiKey.trim()) {
        toast.error("Please enter your API key.");
        return;
      }
      if (!cloudVerified) {
        toast.error("Please verify your API key first.");
        return;
      }
    }
    // Validate custom mode
    if (connectionMode === "custom") {
      if (!embeddingVerified) {
        toast.error("Please test your embedding connection first.");
        return;
      }
      if (!llmVerified) {
        toast.error("Please test your LLM connection first.");
        return;
      }
    }

    setBusy(true);
    try {
      // Create a default server
      const server = await createServer("my-rag");

      // Build config
      const isCloud = connectionMode === "cloud";
      const embeddingModelId = isCloud
        ? (DEFAULT_EMBEDDING_MODEL[provider] ?? "openai/text-embedding-3-large")
        : `custom:${embeddingModelName}`;

      const configBody: Record<string, unknown> = {
        projectName: "my-rag",
        embeddingProvider: isCloud ? provider : "custom",
        embeddingApiKey: isCloud ? apiKey : "",
        embeddingModelId,
        indexType: "hybrid",
        chunking: { chunkSize: 512, chunkOverlap: 64, strategy: "recursive" },
        vectorStore: "lancedb",
        storeConfig: {
          mode: "local",
          dbPath: `./.ragtoolkit/servers/${server?.id}/lancedb`,
        },
        topK: 5,
        // Chat configuration
        chatProvider: isCloud ? provider : "custom",
        chatApiKey: isCloud ? apiKey : "",
        updatedAt: new Date().toISOString(),
      };

      // For custom mode, add custom embedding config and LLM config
      if (!isCloud) {
        configBody.customEmbeddings = [
          {
            baseUrl: embeddingBaseUrl,
            apiKey: embeddingApiKey || undefined,
            modelName: embeddingModelName,
            dimensions: detectedDims ?? 1536,
          },
        ];
        configBody.chatProvider = "custom";
        configBody.chatApiKey = llmApiKey || "";
        configBody.chatModelId = llmModelName;
      }

      // Save config via API
      if (server?.id) {
        await fetch(`/api/config?serverId=${encodeURIComponent(server.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(configBody),
        });
      }

      await setMode("simple");
      toast.success("All set! Let's get started.");
    } catch {
      toast.error("Setup failed. Please try again.");
      setBusy(false);
    }
  }

  const canProceed =
    connectionMode === "cloud"
      ? cloudVerified
      : embeddingVerified && llmVerified;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto"
      style={{ backgroundColor: "#FCFCFB" }}
    >
      {/* Background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 h-[500px] w-[500px] rounded-full bg-stone-200/40 blur-3xl animate-pulse" />
        <div className="absolute -bottom-32 -right-32 h-[600px] w-[600px] rounded-full bg-amber-100/30 blur-3xl animate-pulse [animation-delay:1s]" />
      </div>

      <div className="relative z-10 flex w-full max-w-lg flex-col items-center gap-6 px-6 py-10">
        {/* Back */}
        <button
          type="button"
          onClick={onBack}
          className="self-start flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>

        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <img src="/logo9.png" className="size-8" alt="Larkup RAG" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Connect your AI
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground text-pretty max-w-sm">
              Choose how to connect to an AI provider. We&apos;ll handle
              everything else automatically.
            </p>
          </div>
        </div>

        {/* Connection Mode Tabs */}
        <div className="w-full rounded-xl border bg-white p-1 flex gap-1">
          <button
            type="button"
            onClick={() => setConnectionMode("cloud")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all",
              connectionMode === "cloud"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
          >
            <Cloud className="size-4" />
            Cloud Provider
          </button>
          <button
            type="button"
            onClick={() => setConnectionMode("custom")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all",
              connectionMode === "custom"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
          >
            <Monitor className="size-4" />
            Custom Model
          </button>
        </div>

        {/* Form */}
        <div className="w-full rounded-2xl border bg-transparent p-6 space-y-5">
          {connectionMode === "cloud" ? (
            <>
              {/* Provider Selection */}
              <div className="space-y-2.5">
                <Label className="text-sm font-medium">AI Provider</Label>
                <div className="grid grid-cols-2 gap-2">
                  {CLOUD_PROVIDERS.map(({ key, recommended }) => {
                    const meta = PROVIDER_META[key];
                    if (!meta) return null;
                    const selected = provider === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onProviderChange(key)}
                        className={cn(
                          "relative flex items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left transition-all duration-200",
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/30 hover:bg-muted/30",
                        )}
                      >
                        <ProviderIcon
                          src={meta.iconSrc}
                          alt={meta.label}
                          pillBg={meta.pillBg}
                          size={22}
                        />
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium text-foreground truncate">
                            {meta.label}
                          </span>
                          {recommended && (
                            <span className="text-[10px] font-medium text-primary">
                              Recommended
                            </span>
                          )}
                        </div>
                        {selected && (
                          <CheckCircle2 className="absolute right-2.5 top-2.5 size-4 text-primary" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* API Key */}
              <div className="space-y-2">
                <Label htmlFor="simple-apikey">API Key</Label>
                <div className="relative">
                  <Input
                    id="simple-apikey"
                    type={showApiKey ? "text" : "password"}
                    placeholder="sk-..."
                    value={apiKey}
                    onChange={(e) => onApiKeyChange(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your key is stored locally and never sent to our servers.
                </p>
              </div>

              {/* Test Connection */}
              {cloudVerified ? (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm font-medium text-green-700">
                  <CheckCircle2 className="size-4" />
                  API key verified. Ready to go!
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={testCloudProvider}
                  disabled={testingCloud || !apiKey.trim()}
                >
                  {testingCloud ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-4" />
                  )}
                  Verify API Key
                </Button>
              )}
            </>
          ) : (
            <>
              {/* Embedding Connection */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                    1
                  </span>
                  <Label className="text-sm font-medium">Embedding Model</Label>
                </div>
                <div className="grid gap-2.5 pl-8">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="emb-url"
                      className="text-xs text-muted-foreground"
                    >
                      Base URL
                    </Label>
                    <Input
                      id="emb-url"
                      placeholder="http://localhost:11434/v1"
                      value={embeddingBaseUrl}
                      onChange={(e) => {
                        setEmbeddingBaseUrl(e.target.value);
                        setEmbeddingVerified(false);
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="emb-model"
                      className="text-xs text-muted-foreground"
                    >
                      Model Name
                    </Label>
                    <Input
                      id="emb-model"
                      placeholder="nomic-embed-text"
                      value={embeddingModelName}
                      onChange={(e) => {
                        setEmbeddingModelName(e.target.value);
                        setEmbeddingVerified(false);
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="emb-apikey"
                      className="text-xs text-muted-foreground"
                    >
                      API Key{" "}
                      <span className="text-muted-foreground/60">
                        (optional)
                      </span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="emb-apikey"
                        type={showEmbeddingApiKey ? "text" : "password"}
                        placeholder="sk-..."
                        value={embeddingApiKey}
                        onChange={(e) => {
                          setEmbeddingApiKey(e.target.value);
                          setEmbeddingVerified(false);
                        }}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setShowEmbeddingApiKey(!showEmbeddingApiKey)
                        }
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                      >
                        {showEmbeddingApiKey ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  {embeddingVerified ? (
                    <div className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                      <CheckCircle2 className="size-4" />
                      Connected — {detectedDims} dimensions
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testCustomEmbedding}
                      disabled={testingEmbedding}
                    >
                      {testingEmbedding ? (
                        <Loader2 className="size-3.5 animate-spin mr-1.5" />
                      ) : (
                        <ShieldCheck className="size-3.5 mr-1.5" />
                      )}
                      Test Connection
                    </Button>
                  )}
                </div>
              </div>

              {/* LLM Connection */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                    2
                  </span>
                  <Label className="text-sm font-medium">
                    Chat / LLM Model
                  </Label>
                </div>
                <div className="grid gap-2.5 pl-8">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="llm-url"
                      className="text-xs text-muted-foreground"
                    >
                      Base URL
                    </Label>
                    <Input
                      id="llm-url"
                      placeholder="http://localhost:11434/v1"
                      value={llmBaseUrl}
                      onChange={(e) => setLlmBaseUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="llm-model"
                      className="text-xs text-muted-foreground"
                    >
                      Model Name
                    </Label>
                    <Input
                      id="llm-model"
                      placeholder="llama3.2"
                      value={llmModelName}
                      onChange={(e) => {
                        setLlmModelName(e.target.value);
                        setLlmVerified(false);
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="llm-apikey"
                      className="text-xs text-muted-foreground"
                    >
                      API Key{" "}
                      <span className="text-muted-foreground/60">
                        (optional)
                      </span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="llm-apikey"
                        type={showLlmApiKey ? "text" : "password"}
                        placeholder="sk-..."
                        value={llmApiKey}
                        onChange={(e) => {
                          setLlmApiKey(e.target.value);
                          setLlmVerified(false);
                        }}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLlmApiKey(!showLlmApiKey)}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                      >
                        {showLlmApiKey ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  {llmVerified ? (
                    <div className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                      <CheckCircle2 className="size-4" />
                      LLM connected successfully
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testCustomLlm}
                      disabled={testingLlm}
                    >
                      {testingLlm ? (
                        <Loader2 className="size-3.5 animate-spin mr-1.5" />
                      ) : (
                        <ShieldCheck className="size-3.5 mr-1.5" />
                      )}
                      Test LLM Connection
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    E.g. Ollama, LM Studio, or any OpenAI-compatible endpoint.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Submit */}
        <Button
          className="w-full"
          size="lg"
          onClick={() => void handleFinish()}
          disabled={busy || !canProceed}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowRight className="size-4" />
          )}
          Get Started
        </Button>
      </div>
    </div>
  );
}
