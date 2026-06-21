"use client";

import { useThemeCustomizer } from "./theme-customizer-provider";
import { AppSidebar } from "./app-sidebar";
import { AppTopNav } from "./app-topnav";
import { WorkspaceTopBar } from "@/components/workspace/workspace-top-bar";
import { cn } from "@/lib/utils";

export function ClientLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const { layout, pageStyle } = useThemeCustomizer();

  const containerClasses =
    pageStyle === "fused"
      ? "min-h-[calc(100vh-8rem)] text-foreground"
      : "min-h-[calc(100vh-8rem)] rounded-2xl border border-border bg-panel text-panel-foreground shadow-sm";

  const sidebarContainerClasses =
    pageStyle === "fused"
      ? "min-h-[calc(100vh-1.5rem)] flex flex-col text-foreground"
      : "min-h-[calc(100vh-1.5rem)] flex flex-col rounded-2xl border border-border bg-panel text-panel-foreground shadow-sm overflow-hidden";

  if (layout === "topnav") {
    return (
      <div className="flex min-h-screen flex-col">
        {/* Full width header */}
        <AppTopNav />
        {/* Main layout container */}
        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <div className={cn(containerClasses, "container mx-auto")}>
            {children}
          </div>
        </main>
      </div>
    );
  }

  // Default Sidebar Layout
  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <main className="min-w-0 flex-1 p-3 pl-3 md:pl-0">
        <div className={sidebarContainerClasses}>
          {/* Full width (inside sidebar content area) top bar */}
          <WorkspaceTopBar />
          {/* Main layout container */}
          <div className="flex-1 overflow-auto">
            <div className="container mx-auto pb-8">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
