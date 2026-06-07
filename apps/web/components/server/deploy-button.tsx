"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Rocket, Loader2 } from "lucide-react";
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

export function DeployButton() {
  const [vercelModalOpen, setVercelModalOpen] = useState(false);
  const [vercelToken, setVercelToken] = useState("");
  const [vercelProject, setVercelProject] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("vercel_token");
    const project = localStorage.getItem("vercel_project");
    if (token) setVercelToken(token);
    if (project) setVercelProject(project);
  }, []);

  const handleHetznerDeploy = () => {
    toast.info("Later");
  };

  const handleDeployToVercel = async () => {
    if (!vercelToken || !vercelProject) {
      toast.error("Please enter both Vercel Token and Project ID/Name.");
      return;
    }

    setIsDeploying(true);
    toast.info("Triggering deployment on Vercel...");
    
    try {
      const res = await deployToVercel(vercelToken, vercelProject);
      if (res.success) {
        localStorage.setItem("vercel_token", vercelToken);
        localStorage.setItem("vercel_project", vercelProject);

        toast.success(
          <div className="flex flex-col gap-1">
            <span>Deployment triggered successfully!</span>
            {res.url && (
              <a 
                href={res.url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="underline font-medium hover:text-blue-500 transition-colors"
              >
                View Deployment
              </a>
            )}
          </div>
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

  const handleVercelDeployClick = () => {
    setVercelModalOpen(true);
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
          <Rocket className="size-4 mr-2" />
          Deploy
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleVercelDeployClick}>
            Vercel
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleHetznerDeploy}>
            Hetzner
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={vercelModalOpen} onOpenChange={setVercelModalOpen}>
        <DialogContent className={"max-w-xl"}>
          <DialogHeader>
            <DialogTitle>Deploy to Vercel</DialogTitle>
            <DialogDescription>
              Enter your Vercel credentials. We will save them locally for
              future deployments.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="token">Vercel Access Token</Label>
              <Input
                id="token"
                type="password"
                placeholder="Enter your Vercel Access Token"
                value={vercelToken}
                onChange={(e) => setVercelToken(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project">Project ID or Name</Label>
              <Input
                id="project"
                placeholder="Enter your Vercel Project ID or Name"
                value={vercelProject}
                onChange={(e) => setVercelProject(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVercelModalOpen(false)} disabled={isDeploying}>
              Cancel
            </Button>
            <Button onClick={handleDeployToVercel} disabled={isDeploying}>
              {isDeploying ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Deploy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
