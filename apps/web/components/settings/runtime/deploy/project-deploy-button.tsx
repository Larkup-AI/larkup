'use client';

import { Button } from '@/components/ui/button';
import { Rocket, ChevronDown, Settings2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DEPLOYMENT_TARGETS } from '@/lib/deployments';

interface ProjectDeployButtonProps {
  serverId?: string;
  profile?: 'knowledge' | 'assistant';
  onSaved?: () => void;
  onDeployClick: (target: string) => void;
  showUtilities?: boolean;
  compact?: boolean;
}

export function ProjectDeployButton({
  serverId = 'default',
  profile,
  onSaved,
  onDeployClick,
  showUtilities = false,
  compact = false,
}: ProjectDeployButtonProps) {
  const handleOpenDeploy = (target: string) => {
    onDeployClick(target);
  };

  const handleDownload = (provider: string) => {
    window.open(`/api/server/download?provider=${provider}`);
  };

  return (
    <div className="flex items-center gap-2">
      {showUtilities && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              delay={0}
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className={`${
                    compact ? 'h-8 w-8' : 'h-9 w-9'
                  } shrink-0 text-muted-foreground hover:text-foreground`}
                  onClick={() => handleOpenDeploy('env')}
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
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="default"
              size="default"
              className={`${compact ? 'h-8' : 'h-9'} w-32.5 justify-start gap-1 rounded-md`}
            />
          }
        >
          <div className="w-full flex items-center h-8 justify-between rounded-lg">
            <div className="flex items-center">
              <Rocket className="size-4 mr-2" />
              Deploy
            </div>
            <ChevronDown className="size-4" />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-50">
          <DropdownMenuItem onClick={() => handleOpenDeploy(DEPLOYMENT_TARGETS.Vercel.id)}>
            <div className="flex items-center">
              <img src={DEPLOYMENT_TARGETS.Vercel.icon} className="size-4 mr-2" alt="" />
              {DEPLOYMENT_TARGETS.Vercel.label}
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleOpenDeploy(DEPLOYMENT_TARGETS.Hetzner.id)}>
            <div className="flex items-center">
              <img src={DEPLOYMENT_TARGETS.Hetzner.icon} className="size-4 mr-2" alt="" />
              {DEPLOYMENT_TARGETS.Hetzner.label}
            </div>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <img src={DEPLOYMENT_TARGETS.Azure.icon} className="size-4 mr-2" alt="" />
              {DEPLOYMENT_TARGETS.Azure.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
              <DropdownMenuItem
                disabled
                className="h-auto"
                onClick={() => handleDownload('azure-app-service')}
              >
                <div className="flex flex-col gap-0.5">
                  <span>App Service</span>
                  <span className="text-[10px] text-muted-foreground">Managed PaaS</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled
                className="h-auto"
                onClick={() => handleDownload('azure-container-apps')}
              >
                <div className="flex flex-col gap-0.5">
                  <span>Container Apps</span>
                  <span className="text-[10px] text-muted-foreground">Serverless containers</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="h-auto"
                onClick={() => handleOpenDeploy(DEPLOYMENT_TARGETS.Azure.id)}
              >
                <div className="flex flex-col gap-0.5">
                  <span>Virtual Machines</span>
                  <span className="text-[10px] text-muted-foreground">Full IaaS</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <img src={DEPLOYMENT_TARGETS.AWS.icon} className="size-4 mr-2" alt="" />
              {DEPLOYMENT_TARGETS.AWS.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
              <DropdownMenuItem
                disabled
                className="h-auto"
                onClick={() => handleDownload('aws-elastic-beanstalk')}
              >
                <div className="flex flex-col gap-0.5">
                  <span>Elastic Beanstalk</span>
                  <span className="text-[10px] text-muted-foreground">Managed PaaS</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled
                className="h-auto"
                onClick={() => handleDownload('aws-app-runner')}
              >
                <div className="flex flex-col gap-0.5">
                  <span>App Runner / Fargate</span>
                  <span className="text-[10px] text-muted-foreground">Serverless containers</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="h-auto"
                onClick={() => handleOpenDeploy(DEPLOYMENT_TARGETS.AWS.id)}
              >
                <div className="flex flex-col gap-0.5">
                  <span>EC2</span>
                  <span className="text-[10px] text-muted-foreground">Full IaaS</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <img src={DEPLOYMENT_TARGETS.GCP.icon} className="size-4 mr-2" alt="" />
              {DEPLOYMENT_TARGETS.GCP.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
              <DropdownMenuItem
                disabled
                className="h-auto"
                onClick={() => handleDownload('gcp-app-engine')}
              >
                <div className="flex flex-col gap-0.5">
                  <span>App Engine</span>
                  <span className="text-[10px] text-muted-foreground">Managed PaaS</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled
                className="h-auto"
                onClick={() => handleDownload('gcp-cloud-run')}
              >
                <div className="flex flex-col gap-0.5">
                  <span>Cloud Run</span>
                  <span className="text-[10px] text-muted-foreground">Serverless containers</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="h-auto"
                onClick={() => handleOpenDeploy(DEPLOYMENT_TARGETS.GCP.id)}
              >
                <div className="flex flex-col gap-0.5">
                  <span>Compute Engine</span>
                  <span className="text-[10px] text-muted-foreground">Full IaaS</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <img src={DEPLOYMENT_TARGETS.DigitalOcean.icon} className="size-4 mr-2" alt="" />
              {DEPLOYMENT_TARGETS.DigitalOcean.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
              <DropdownMenuItem
                disabled
                className="h-auto"
                onClick={() => handleDownload('digitalocean-app-platform')}
              >
                <div className="flex flex-col gap-0.5">
                  <span>App Platform</span>
                  <span className="text-[10px] text-muted-foreground">Managed PaaS</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="h-auto"
                onClick={() => handleOpenDeploy(DEPLOYMENT_TARGETS.DigitalOcean.id)}
              >
                <div className="flex flex-col gap-0.5">
                  <span>Droplets</span>
                  <span className="text-[10px] text-muted-foreground">Full IaaS</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
