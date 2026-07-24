'use client';

import { useEffect, useRef, useState } from 'react';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { toast } from 'sonner';
import { DeploySheet } from './deploy-sheet';

interface DeployButtonProps {
  serverId?: string;
  showUtilities?: boolean;
  compact?: boolean;
  openTarget?: 'vercel' | 'hetzner';
  openSignal?: number;
}

export function DeployButton({
  serverId = 'default',
  showUtilities = true,
  compact = false,
  openTarget,
  openSignal,
}: DeployButtonProps) {
  const [deploySheetOpen, setDeploySheetOpen] = useState(false);
  const [deployTarget, setDeployTarget] = useState<string | null>(null);
  const lastOpenSignal = useRef(0);

  const handleOpenDeploy = (target: string) => {
    setDeployTarget(target);
    setDeploySheetOpen(true);
  };

  const handleDownload = (provider: string) => {
    toast.success(`Downloading deployment package for ${provider}...`);
    window.open(`/api/server/download?provider=${provider}`);
  };

  useEffect(() => {
    if (!openTarget || !openSignal || openSignal === lastOpenSignal.current) return;
    lastOpenSignal.current = openSignal;
    handleOpenDeploy(openTarget);
  }, [openSignal, openTarget]);

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
              className={`${compact ? 'h-8' : 'h-9'} w-[130px] justify-start gap-1 rounded-md`}
            />
          }
        >
          <div className="w-full flex items-center h-8 justify-between rounded-lg">
            <div className="flex items-center">
              <Rocket className="size-4 mr-2" />
              Deploy
            </div>
            <ChevronDown />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[200px]">
          <DropdownMenuItem onClick={() => handleOpenDeploy('vercel')}>
            <p className="flex items-center">
              <img src="/vercel.svg" className="size-4 mr-2" alt="Vercel" />
              Vercel
            </p>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleOpenDeploy('hetzner')}>
            <p className="flex items-center">
              <img src="/hetzner.svg" className="size-4 mr-2" alt="Hetzner" />
              Hetzner
            </p>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <img src="/icons/azure.svg" className="size-4 mr-2" alt="Azure" />
              Azure
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[240px]">
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
              <DropdownMenuItem className="h-auto" onClick={() => handleOpenDeploy('azure')}>
                <div className="flex flex-col gap-0.5">
                  <span>Virtual Machines</span>
                  <span className="text-[10px] text-muted-foreground">Full IaaS</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <img src="/icons/aws.svg" className="size-4 mr-2" alt="AWS" />
              AWS
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[240px]">
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
              <DropdownMenuItem className="h-auto" onClick={() => handleOpenDeploy('aws')}>
                <div className="flex flex-col gap-0.5">
                  <span>EC2</span>
                  <span className="text-[10px] text-muted-foreground">Full IaaS</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <img src="/icons/gcp.svg" className="size-4 mr-2" alt="GCP" />
              GCP
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[240px]">
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
              <DropdownMenuItem className="h-auto" onClick={() => handleOpenDeploy('gcp')}>
                <div className="flex flex-col gap-0.5">
                  <span>Compute Engine</span>
                  <span className="text-[10px] text-muted-foreground">Full IaaS</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <img src="/icons/digital-ocean.webp" className="size-4 mr-2" alt="DigitalOcean" />
              DigitalOcean
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[240px]">
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
              <DropdownMenuItem className="h-auto" onClick={() => handleOpenDeploy('digitalocean')}>
                <div className="flex flex-col gap-0.5">
                  <span>Droplets</span>
                  <span className="text-[10px] text-muted-foreground">Full IaaS</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeploySheet
        open={deploySheetOpen}
        onOpenChange={setDeploySheetOpen}
        target={deployTarget}
        serverId={serverId}
      />
    </div>
  );
}
