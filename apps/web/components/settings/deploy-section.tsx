"use client";

import { useWorkspace } from "@/components/workspace/workspace-provider";
import { DeployButton } from "@/components/server/deploy-button";

export function DeploySection() {
  const { activeServer } = useWorkspace();
  const serverId = activeServer?.id || "default";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Deploy</h2>
        <p className="text-sm text-muted-foreground">
          Deploy your AI server to the cloud for production use.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <DeployButton serverId={serverId} />
      </div>
    </div>
  );
}
