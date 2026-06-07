"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Rocket,
  Loader2,
  ChevronDown,
  Eye,
  EyeOff,
  CheckCircle2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { deployToVercel } from "@/app/actions/vercel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ─── Storage helpers ──────────────────────────────────────────────────────────
// Token is stored globally so it loads on every server automatically.
// Project name is stored per-server (keyed by serverId).

const GLOBAL_TOKEN_KEY = "vercel_token";

function projectKey(serverId: string) {
  return `vercel_project_${serverId}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface DeployButtonProps {
  /** Unique identifier for this server instance (used to scope the project name). */
  serverId?: string;
}

export function DeployButton({ serverId = "default" }: DeployButtonProps) {
  const [vercelModalOpen, setVercelModalOpen] = useState(false);
  const [vercelToken, setVercelToken] = useState("");
  const [vercelProject, setVercelProject] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // ── Was the token already saved globally?
  const [tokenWasSaved, setTokenWasSaved] = useState(false);

  // Load on mount: token is global, project is per-server
  useEffect(() => {
    const savedToken = localStorage.getItem(GLOBAL_TOKEN_KEY);
    const savedProject = localStorage.getItem(projectKey(serverId));

    if (savedToken) {
      setVercelToken(savedToken);
      setTokenWasSaved(true);
    }
    if (savedProject) {
      setVercelProject(savedProject);
    }
  }, [serverId]);

  const handleClearToken = () => {
    localStorage.removeItem(GLOBAL_TOKEN_KEY);
    setVercelToken("");
    setTokenWasSaved(false);
    toast.info("Vercel token cleared.");
  };

  const handleHetznerDeploy = () => {
    toast.info("Hetzner deployment coming soon.");
  };

  const handleDeployToVercel = async () => {
    if (!vercelToken || !vercelProject) {
      toast.error("Please enter both a Vercel Token and a Project name.");
      return;
    }

    setIsDeploying(true);
    toast.info("Triggering deployment on Vercel…");

    try {
      const res = await deployToVercel(vercelToken, vercelProject);

      if (res.success) {
        // ── Persist: token globally, project per-server
        localStorage.setItem(GLOBAL_TOKEN_KEY, vercelToken);
        localStorage.setItem(projectKey(serverId), vercelProject);
        setTokenWasSaved(true);

        const title = res.projectCreated
          ? "Project created & deployment triggered!"
          : "Deployment triggered successfully!";

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
          </div>,
        );
        setVercelModalOpen(false);
      } else {
        toast.error(res.error || "Failed to trigger deployment.");
      }
    } catch (e: any) {
      toast.error(e.message || "An unexpected error occurred.");
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <>
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
            Vercel
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleHetznerDeploy}>
            Hetzner
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={vercelModalOpen} onOpenChange={setVercelModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Deploy to Vercel</DialogTitle>
            <DialogDescription>
              Your Vercel token is saved globally — it will be available on
              every server automatically. The project name is saved per server.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* ── Token ── */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label htmlFor="vercel-token">Vercel Access Token</Label>
                  {tokenWasSaved && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="size-3" />
                      Saved globally
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
              {isDeploying && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Deploy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
