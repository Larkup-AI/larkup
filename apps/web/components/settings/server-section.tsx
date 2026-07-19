"use client";

import { useState, useEffect } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import {
  Loader2,
  Play,
  Server,
  Square,
  ExternalLink,
  Terminal,
  Copy,
  CheckCircle2,
  RefreshCw,
  Key,
  Trash2,
  Webhook,
  Hash,
  MessageSquare,
  Send,
  Phone,
  Plug,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { SdkConnectDialog } from "@/components/simple/sdk-connect-dialog";
import { DeployButton } from "@/components/server/deploy-button";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface LocalServerState {
  running: boolean;
  pid?: number;
  port: number;
  endpoint: string;
  startedAt?: string;
  lastError?: string;
}

export function ServerSection() {
  const { activeServer, refresh } = useWorkspace();
  const serverId = activeServer?.id || "default";

  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [remoteProvider, setRemoteProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    const url = localStorage.getItem(`vercel_deployed_url_${serverId}`);
    const provider = localStorage.getItem(
      `vercel_deployed_provider_${serverId}`,
    );
    const savedApiKey = localStorage.getItem("rag_server_api_key");
    if (url) setRemoteUrl(url);
    if (provider) setRemoteProvider(provider);
    if (savedApiKey) setApiKey(savedApiKey);
  }, [serverId]);

  const { data, mutate } = useSWR<{ state: LocalServerState }>(
    "/api/server/local",
    fetcher,
    { refreshInterval: (d) => (d?.state.running ? 5000 : 0) },
  );
  const state = data?.state;

  async function control(action: "start" | "stop") {
    setBusy(action);
    const isStarting = action === "start";

    // Optimistically update local state
    mutate({ state: { ...(state as LocalServerState), running: isStarting } }, false);
    
    // Optimistically update global workspace state for the sidebar icon
    globalMutate(
      "/api/servers",
      (currentData: any) => {
        if (!currentData) return currentData;
        return {
          ...currentData,
          servers: currentData.servers.map((s: any) =>
            s.id === serverId ? { ...s, running: isStarting } : s
          ),
        };
      },
      false
    );

    try {
      const currentApiKey = localStorage.getItem("rag_server_api_key") || "";
      const res = await fetch("/api/server/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, serverApiKey: currentApiKey }),
      });
      const body = await res.json();
      if (action === "start") {
        if (body.state?.running) {
          toast.success("Server is running.");
        } else {
          toast.error(body.state?.lastError ?? "Server did not start.");
          globalMutate("/api/servers"); // Revert
        }
      } else {
        toast.success("Server stopped.");
      }
      mutate();
      refresh();
    } catch {
      toast.error("Could not reach the server controller.");
      globalMutate("/api/servers"); // Revert
      mutate();
    } finally {
      setBusy(null);
    }
  }

  function handleApiKeyChange(v: string) {
    setApiKey(v);
    localStorage.setItem("rag_server_api_key", v);
  }

  function generateApiKey() {
    const key =
      "sk-" +
      Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    handleApiKeyChange(key);
    toast.success("API key generated");
  }

  async function copyApiKey() {
    await navigator.clipboard.writeText(apiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1500);
  }

  function removeRemoteServer() {
    localStorage.removeItem(`vercel_deployed_url_${serverId}`);
    localStorage.removeItem(`vercel_deployed_provider_${serverId}`);
    setRemoteUrl(null);
    setRemoteProvider(null);
    toast.success("Remote server removed.");
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Server</h2>
        <p className="text-sm text-muted-foreground">
          Launch, manage, and connect to your AI server.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Server className="size-3.5 text-primary" />
            Local Server
          </CardTitle>
          {state?.running && (
            <span className="flex items-center gap-1.5 text-xs text-green-700">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-600 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-green-600" />
              </span>
              running on :{state.port}
            </span>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Start the server locally to test your AI endpoints. Your
            configuration and API keys will be applied automatically.
          </p>

          {state?.running && (
            <Alert>
              <ExternalLink className="size-4" />
              <AlertTitle>API Documentation</AlertTitle>
              <AlertDescription>
                <div className="mt-0">
                  <a
                    href={`${state.endpoint}/reference`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    Open API Reference
                  </a>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {state?.lastError && !state.running && (
            <Alert variant="destructive">
              <AlertTitle>Launch failed</AlertTitle>
              <AlertDescription className="wrap-break-word">
                {state.lastError}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {state?.running ? (
              <>
                <Button
                  variant="destructive"
                  onClick={() => control("stop")}
                  disabled={busy !== null}
                  className={"rounded-md"}
                >
                  {busy === "stop" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Square className="size-4 text-white!" />
                  )}
                  Stop server
                </Button>
                <a
                  href={state.endpoint}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ variant: "secondary" }),
                    "rounded-md",
                  )}
                >
                  <ExternalLink className="size-4" />
                  {state.endpoint}
                </a>
              </>
            ) : (
              <Button
                className={"rounded-md"}
                onClick={() => control("start")}
                disabled={busy !== null}
              >
                {busy === "start" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                {busy === "start" ? "Starting…" : "Launch server"}
              </Button>
            )}
            <SdkConnectDialog
              serverUrl={state?.endpoint || "http://localhost:8080"}
            />
          </div>

          {state?.running && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Terminal className="size-3.5" />
                <span>Test your endpoint</span>
              </div>
              <Dialog>
                <DialogTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2 gap-1.5"
                    />
                  }
                >
                  <Terminal className="size-3" />
                  Try it (cURL)
                </DialogTrigger>
                <DialogContent className="max-w-xl">
                  <DialogHeader>
                    <DialogTitle>cURL Example</DialogTitle>
                    <DialogDescription>
                      You can use this command to test your RAG server endpoint.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="relative rounded-md bg-muted p-4 mt-2 border border-border/50">
                    <pre className="font-mono text-xs overflow-x-auto text-foreground pb-4 pr-6">
                      <code>{`curl -X POST ${state.endpoint}/query \\
  -H "Content-Type: application/json" \\${apiKey ? `\n  -H "Authorization: Bearer ${apiKey}" \\` : ""}
  -d '{"query":"hello"}'`}</code>
                    </pre>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `curl -X POST ${state.endpoint}/query -H "Content-Type: application/json"${apiKey ? ` -H "Authorization: Bearer ${apiKey}"` : ""} -d '{"query":"hello"}'`,
                        );
                        toast.success("Command copied");
                      }}
                    >
                      <Copy className="size-3" />
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {remoteUrl && (
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground min-w-[110px]">
                  <Server className="size-4 shrink-0" />
                  Remote server
                </div>
                <a
                  href={remoteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "outline" })}
                >
                  <ExternalLink className="size-4" />
                  {remoteUrl.replace(/^https?:\/\//, "")}
                </a>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove remote server?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove the remote server connection from this
                        workspace. The deployed server itself will not be
                        deleted from your provider.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={removeRemoteServer}
                        className="bg-destructive hover:bg-destructive/90"
                      >
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
          {!remoteUrl && (
            <div className="space-y-3 pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    Deploy to Cloud
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Deploy your AI server to Vercel for production use.
                  </p>
                </div>
                <DeployButton serverId={serverId} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Key className="size-3.5 text-primary" />
            Server API Key
          </CardTitle>
          <CardDescription className="text-xs">
            Protect your server with an API key. Clients must send this key in
            the{" "}
            <code className="text-[11px] bg-muted px-1 py-0.5 rounded">
              Authorization
            </code>{" "}
            header.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder="sk-..."
              className="flex-1 font-mono text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 h-9 w-9"
              onClick={copyApiKey}
              disabled={!apiKey}
            >
              {copiedKey ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="default"
              className="shrink-0 gap-1.5 h-9"
              onClick={generateApiKey}
            >
              <RefreshCw className="size-3.5" />
              Generate
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Stored locally in your browser. Generate a new key or paste your
            own.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
