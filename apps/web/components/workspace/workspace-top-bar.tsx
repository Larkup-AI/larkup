"use client"

import { ServerSwitcher } from "./server-switcher"
import { useWorkspace } from "./workspace-provider"

/**
 * Global, always-visible bar at the top of the panel. Hosts the server
 * switcher (top-left) so users can add/select servers from anywhere.
 */
export function WorkspaceTopBar() {
  const { username } = useWorkspace()

  return (
    <div className="sticky top-0 z-20 flex items-center justify-between gap-3 rounded-t-2xl border-b border-border bg-panel/85 px-4 py-2.5 backdrop-blur supports-backdrop-filter:bg-panel/70 md:px-6">
      <ServerSwitcher />
      {username && (
        <span className="hidden text-sm text-muted-foreground sm:block">
          Hi, <span className="font-medium text-foreground">{username}</span>
        </span>
      )}
    </div>
  )
}
