"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Rocket,
  Loader2,
  ChevronDown,
  Eye,
  EyeOff,
  CheckCircle2,
  Dices,
  Copy,
  Settings2,
  KeyRound,
  Cloud,
} from "lucide-react";
import { toast } from "sonner";
import { deployToVercel, getServerEnvRequirements } from "@/app/actions/vercel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

// ─── Storage helpers ──────────────────────────────────────────────────────────
// Token is stored globally so it loads on every server automatically.
// Project name and deployed URL are stored per-server (keyed by serverId).

const GLOBAL_TOKEN_KEY = "vercel_token";

function projectKey(serverId: string) {
  return `vercel_project_${serverId}`;
}
function deployedUrlKey(serverId: string) {
  return `vercel_deployed_url_${serverId}`;
}
function deployedProviderKey(serverId: string) {
  return `vercel_deployed_provider_${serverId}`;
}

// ─── Vercel triangle SVG icon ─────────────────────────────────────────────────
function VercelIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2L2 19.778h20L12 2z" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface DeployButtonProps {
  /** Unique identifier for this server instance (used to scope the project name). */
  serverId?: string;
}

export function DeployButton({ serverId = "default" }: DeployButtonProps) {
  const [vercelModalOpen, setVercelModalOpen] = useState(false);
  const [envModalOpen, setEnvModalOpen] = useState(false);
  const [vercelToken, setVercelToken] = useState("");
  const [vercelProject, setVercelProject] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showEnvVars, setShowEnvVars] = useState<Record<string, boolean>>({});

  // Dynamic Environment Variables
  const [requiredEnv, setRequiredEnv] = useState<
    { key: string; help: string; required: boolean; defaultValue?: string }[]
  >([]);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});

  // ── Was the token already saved globally?
  const [tokenWasSaved, setTokenWasSaved] = useState(false);

  // ── Persisted deployment info (shown in UI after successful deploy)
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);
  const [deployedProvider, setDeployedProvider] = useState<string | null>(null);

  // ── Env summary counts
  const envSummary = useMemo(() => {
    const total = requiredEnv.length + 1; // +1 for SERVER_API_KEY
    const filled =
      requiredEnv.filter((e) => !!envValues[e.key]).length + (apiKey ? 1 : 0);
    const requiredMissing = requiredEnv.filter(
      (e) => e.required && !envValues[e.key],
    ).length;
    return { total, filled, requiredMissing };
  }, [requiredEnv, envValues, apiKey]);

  // Load on mount: token is global, project/url are per-server
  useEffect(() => {
    const savedToken = localStorage.getItem(GLOBAL_TOKEN_KEY);
    const savedProject = localStorage.getItem(projectKey(serverId));
    const savedUrl = localStorage.getItem(deployedUrlKey(serverId));
    const savedProvider = localStorage.getItem(deployedProviderKey(serverId));
    const savedApiKey = localStorage.getItem("rag_server_api_key");

    if (savedApiKey) {
      setApiKey(savedApiKey);
    }
    if (savedToken) {
      setVercelToken(savedToken);
      setTokenWasSaved(true);
    }
    if (savedProject) {
      setVercelProject(savedProject);
    }
    if (savedUrl) {
      setDeployedUrl(savedUrl);
    }
    if (savedProvider) {
      setDeployedProvider(savedProvider);
    }
  }, [serverId]);

  useEffect(() => {
    if ((vercelModalOpen || envModalOpen) && serverId) {
      getServerEnvRequirements(serverId).then((reqs) => {
        setRequiredEnv(reqs);
        // Only pre-fill keys that are present in the CURRENT config's .env.example.
        // This prevents stale keys from a previously-selected store (e.g. LanceDB vars
        // bleeding into a Pinecone configuration) from appearing in the sheet.
        const savedEnvStr = localStorage.getItem("rag_server_env_vars");
        const savedEnv = savedEnvStr ? JSON.parse(savedEnvStr) : {};

        const initialVals: Record<string, string> = {};
        for (const req of reqs) {
          // Only use the saved value if the key is actually required by the current config.
          initialVals[req.key] = savedEnv[req.key] || req.defaultValue || "";
        }
        // Replace envValues wholesale — clear any keys from a previous store selection.
        setEnvValues(initialVals);
      });
    }
  }, [vercelModalOpen, envModalOpen, serverId]);

  const handleSaveEnv = async () => {
    if (apiKey) {
      localStorage.setItem("rag_server_api_key", apiKey);
    } else {
      localStorage.removeItem("rag_server_api_key");
    }
    localStorage.setItem("rag_server_env_vars", JSON.stringify(envValues));
    setEnvModalOpen(false);

    // Check if the local server is running — if so, restart it with the new key.
    try {
      const statusRes = await fetch("/api/server/local");
      const { state } = await statusRes.json();

      if (state?.running) {
        toast.loading("Restarting local server with new API key…", { id: "restart" });
        const restartRes = await fetch("/api/server/local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", serverApiKey: apiKey || "" }),
        });
        const body = await restartRes.json();
        if (body.state?.running) {
          toast.success("Local server restarted with new API key.", { id: "restart" });
        } else {
          toast.error(body.state?.lastError ?? "Restart failed — relaunch manually.", { id: "restart" });
        }
      } else {
        toast.success("Environment configuration saved.");
      }
    } catch {
      toast.success("Environment configuration saved.");
    }
  };

  const handleClearToken = () => {
    localStorage.removeItem(GLOBAL_TOKEN_KEY);
    setVercelToken("");
    setTokenWasSaved(false);
    toast.info("Vercel token cleared.");
  };

  const handleHetznerDeploy = () => {
    toast.info("Hetzner deployment coming soon.");
  };

  const handleGenerateKey = () => {
    const randomKey =
      "buddy-" +
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);
    setApiKey(randomKey);
    localStorage.setItem("rag_server_api_key", randomKey);
  };

  const handleCopyKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      toast.success("Server API Key copied to clipboard.");
    }
  };

  const handleDeployToVercel = async () => {
    if (!vercelToken || !vercelProject) {
      toast.error("Please enter both a Vercel Token and a Project name.");
      return;
    }

    for (const req of requiredEnv) {
      if (req.required && !envValues[req.key]) {
        toast.error(
          `Please provide a value for ${req.key}. Open "Configure Environment" to set it.`,
        );
        return;
      }
    }

    setIsDeploying(true);
    toast.info("Uploading files and triggering deployment on Vercel…");

    try {
      // Merge user inputs
      const finalEnvVars = { ...envValues };
      if (apiKey) {
        finalEnvVars["SERVER_API_KEY"] = apiKey;
        localStorage.setItem("rag_server_api_key", apiKey);
      }

      const res = await deployToVercel(
        vercelToken,
        vercelProject,
        serverId,
        finalEnvVars,
      );

      if (res.success) {
        // ── Persist: token globally, project + url per-server
        localStorage.setItem(GLOBAL_TOKEN_KEY, vercelToken);
        localStorage.setItem(projectKey(serverId), vercelProject);
        localStorage.setItem(deployedUrlKey(serverId), res.url!);
        localStorage.setItem(deployedProviderKey(serverId), "vercel");
        setTokenWasSaved(true);
        setDeployedUrl(res.url!);
        setDeployedProvider("vercel");

        const title = res.projectCreated
          ? "Project created & files deployed!"
          : "Server files deployed successfully!";

        toast.success(
          <div className="flex flex-col gap-1">
            <span>{title}</span>
            {res.url && (
              <a
                href={res.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium hover:text-blue-500 transition-colors"
              >
                View on Vercel ↗
              </a>
            )}
            {res.projectCreated && (
              <span className="text-xs text-muted-foreground">
                Your backend is now live.
              </span>
            )}
          </div>,
        );
        setVercelModalOpen(false);
      } else {
        toast.error(res.error || "Failed to deploy files to Vercel.");
      }
    } catch (e: any) {
      toast.error(e.message || "An unexpected error occurred.");
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            delay={0}
            render={
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => setEnvModalOpen(true)}
              >
                <Settings2 className="size-4" />
              </Button>
            }
          />
          <TooltipContent>
            <p>Environment Variables</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Button
        variant="outline"
        className="h-9 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => {
          const currentKey =
            apiKey || localStorage.getItem("rag_server_api_key");
          if (currentKey) {
            navigator.clipboard.writeText(currentKey);
            toast.success("Server API Key copied to clipboard.");
          } else {
            toast.error("No Server API Key is set.");
          }
        }}
        title="Copy Server API Key"
      >
        <KeyRound className="size-3.5" />
        Copy API Key
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="default"
              size="default"
              className="h-9 w-[130px] justify-start gap-1"
            />
          }
        >
          <div className="w-full flex items-center justify-between">
            <div className="flex items-center">
              <Rocket className="size-4 mr-2" />
              Deploy
            </div>
            <ChevronDown />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setVercelModalOpen(true)}>
            <p className="flex items-center">
              <img src={"/vercel.svg"} className="size-4 mr-2" alt="vercel" />
              Vercel
            </p>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleHetznerDeploy}>
            <p className="flex items-center">
              <img src={"/hetzner.svg"} className="size-4 mr-2" alt="vercel" />
              Hetzner
            </p>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Cloud className="size-4 mr-2" />
              Azure
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => toast.info("Azure App Service deployment coming soon.")}>
                <div className="flex flex-col gap-0.5">
                  <span>App Service</span>
                  <span className="text-[10px] text-muted-foreground">Managed PaaS</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info("Azure Container Apps deployment coming soon.")}>
                <div className="flex flex-col gap-0.5">
                  <span>Container Apps</span>
                  <span className="text-[10px] text-muted-foreground">Serverless containers</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info("Azure Virtual Machines deployment coming soon.")}>
                <div className="flex flex-col gap-0.5">
                  <span>Virtual Machines</span>
                  <span className="text-[10px] text-muted-foreground">Full IaaS</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Cloud className="size-4 mr-2" />
              AWS
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => toast.info("AWS Elastic Beanstalk deployment coming soon.")}>
                <div className="flex flex-col gap-0.5">
                  <span>Elastic Beanstalk</span>
                  <span className="text-[10px] text-muted-foreground">Managed PaaS</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info("AWS App Runner / Fargate deployment coming soon.")}>
                <div className="flex flex-col gap-0.5">
                  <span>App Runner / Fargate</span>
                  <span className="text-[10px] text-muted-foreground">Serverless containers</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info("AWS EC2 deployment coming soon.")}>
                <div className="flex flex-col gap-0.5">
                  <span>EC2</span>
                  <span className="text-[10px] text-muted-foreground">Full IaaS</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Cloud className="size-4 mr-2" />
              GCP
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => toast.info("GCP App Engine deployment coming soon.")}>
                <div className="flex flex-col gap-0.5">
                  <span>App Engine</span>
                  <span className="text-[10px] text-muted-foreground">Managed PaaS</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info("GCP Cloud Run deployment coming soon.")}>
                <div className="flex flex-col gap-0.5">
                  <span>Cloud Run</span>
                  <span className="text-[10px] text-muted-foreground">Serverless containers</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info("GCP Compute Engine deployment coming soon.")}>
                <div className="flex flex-col gap-0.5">
                  <span>Compute Engine</span>
                  <span className="text-[10px] text-muted-foreground">Full IaaS</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Cloud className="size-4 mr-2" />
              DigitalOcean
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => toast.info("DigitalOcean App Platform deployment coming soon.")}>
                <div className="flex flex-col gap-0.5">
                  <span>App Platform</span>
                  <span className="text-[10px] text-muted-foreground">Managed PaaS / Containers</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info("DigitalOcean Droplets deployment coming soon.")}>
                <div className="flex flex-col gap-0.5">
                  <span>Droplets</span>
                  <span className="text-[10px] text-muted-foreground">Full IaaS</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ── Main Deploy Modal ── */}
      <Dialog open={vercelModalOpen} onOpenChange={setVercelModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deploy to Vercel</DialogTitle>
            <DialogDescription>
              Configure your Vercel project and deploy your RAG server.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-4">
            {/* ── Token ── */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label htmlFor="vercel-token">Vercel Access Token</Label>
                  {tokenWasSaved && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="size-3" />
                      Saved
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href="https://vercel.com/account/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground underline hover:text-foreground transition-colors"
                  >
                    Get token ↗
                  </a>
                  {tokenWasSaved && (
                    <button
                      type="button"
                      onClick={handleClearToken}
                      className="text-xs text-destructive underline hover:opacity-80 transition-opacity"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="relative">
                <Input
                  id="vercel-token"
                  type={showToken ? "text" : "password"}
                  placeholder="Enter your Vercel Access Token"
                  value={vercelToken}
                  onChange={(e) => {
                    setVercelToken(e.target.value);
                    setTokenWasSaved(false);
                  }}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showToken ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            {/* ── Project ── */}
            <div className="grid gap-2">
              <Label htmlFor="vercel-project">
                Project ID or Name
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  (saved per server)
                </span>
              </Label>
              <Input
                id="vercel-project"
                placeholder="my-rag-server"
                value={vercelProject}
                onChange={(e) => setVercelProject(e.target.value)}
              />
            </div>

            {/* ── Environment Variables Summary + Button ── */}
            <div className="border-t border-border pt-4 mt-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">Environment Variables</h4>
                  {envSummary.filled > 0 && (
                    <Badge
                      variant="secondary"
                      className="text-[11px] font-normal tabular-nums"
                    >
                      {envSummary.filled}/{envSummary.total} configured
                    </Badge>
                  )}
                  {envSummary.requiredMissing > 0 && (
                    <Badge
                      variant="destructive"
                      className="text-[11px] font-normal"
                    >
                      {envSummary.requiredMissing} required
                    </Badge>
                  )}
                  {envSummary.requiredMissing === 0 &&
                    envSummary.filled > 0 && (
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                    )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[11px] gap-1.5"
                  onClick={() => setEnvModalOpen(true)}
                >
                  <Settings2 className="size-3.5" />
                  Configure
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                API keys and settings your deployed server needs to run.
              </p>
            </div>

            {/* ── Current deployed URL ── */}
            {deployedUrl && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                <VercelIcon className="size-3 shrink-0 text-foreground" />
                <span className="text-muted-foreground">
                  Currently deployed at:
                </span>
                <a
                  href={deployedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono font-medium text-foreground hover:underline truncate"
                >
                  {deployedUrl.replace(/^https?:\/\//, "")}
                </a>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setVercelModalOpen(false)}
              disabled={isDeploying}
            >
              Cancel
            </Button>
            <Button onClick={handleDeployToVercel} disabled={isDeploying}>
              {isDeploying && <Loader2 className="mr-2 size-4 animate-spin" />}
              Deploy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Environment Variables Sheet (nested) ── */}
      <Sheet open={envModalOpen} onOpenChange={setEnvModalOpen}>
        <SheetContent className="max-w-lg overflow-y-auto sm:max-w-xl! w-full p-1 px-3 pb-0 mb-0">
          <SheetHeader>
            <SheetTitle>Environment Variables</SheetTitle>
            <SheetDescription>
              Configure the API keys and settings your RAG server needs. Values
              from your workspace{" "}
              <code className="font-mono text-[13px]">.env</code> are pre-filled
              automatically.
            </SheetDescription>
          </SheetHeader>

          <div className="grid gap-5 py-6">
            {/* ── SERVER_API_KEY (with generate / copy) ── */}
            <div className="grid gap-2">
              <Label htmlFor="server-api-key">
                SERVER_API_KEY
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  (Optional — secures your deployed endpoints)
                </span>
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="server-api-key"
                    type={showApiKey ? "text" : "password"}
                    placeholder="Leave blank for public access"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      localStorage.setItem(
                        "rag_server_api_key",
                        e.target.value,
                      );
                    }}
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showApiKey ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={handleGenerateKey}
                        >
                          <Dices className="size-4" />
                        </Button>
                      }
                    />
                    <TooltipContent>
                      <p>Generate random key</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyKey}
                  disabled={!apiKey}
                  title="Copy Token"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>

            {/* ── Divider ── */}
            {requiredEnv.length > 0 && (
              <div className="border-t border-border" />
            )}

            {/* ── Dynamic Env Vars from .env.example ── */}
            {requiredEnv.map((env) => (
              <div key={env.key} className="grid gap-2">
                <Label htmlFor={`env-${env.key}`}>
                  {env.key}
                  {!env.required && (
                    <span className="ml-2 text-xs text-muted-foreground font-normal">
                      (Optional)
                    </span>
                  )}
                  {env.required && envValues[env.key] && (
                    <span className="inline-flex items-center gap-1 ml-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="size-3" />
                      Pre-filled
                    </span>
                  )}
                </Label>
                {env.key.toLowerCase().includes("key") ||
                env.key.toLowerCase().includes("secret") ? (
                  <div className="relative">
                    <Input
                      id={`env-${env.key}`}
                      type={showEnvVars[env.key] ? "text" : "password"}
                      placeholder={env.help || `Enter ${env.key}`}
                      value={envValues[env.key] || ""}
                      onChange={(e) =>
                        setEnvValues({
                          ...envValues,
                          [env.key]: e.target.value,
                        })
                      }
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowEnvVars((prev) => ({
                          ...prev,
                          [env.key]: !prev[env.key],
                        }))
                      }
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showEnvVars[env.key] ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                ) : (
                  <Input
                    id={`env-${env.key}`}
                    type="text"
                    placeholder={env.help || `Enter ${env.key}`}
                    value={envValues[env.key] || ""}
                    onChange={(e) =>
                      setEnvValues({ ...envValues, [env.key]: e.target.value })
                    }
                  />
                )}
                {env.help && (
                  <p className="text-xs text-muted-foreground">{env.help}</p>
                )}
              </div>
            ))}

            {requiredEnv.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                No additional environment variables required for this server
                configuration.
              </p>
            )}
          </div>

          <SheetFooter className="sticky bottom-0 z-10 -mx-3 mt-auto flex-row justify-between border-t bg-background px-4 py-4 sm:flex-row sm:justify-between sm:space-x-0">
            <Button
              variant="outline"
              className={"bg-white px-5"}
              onClick={() => setEnvModalOpen(false)}
            >
              Cancel
            </Button>
            <Button className={"px-7"} onClick={handleSaveEnv}>
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
