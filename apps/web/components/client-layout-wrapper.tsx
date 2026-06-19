"use client";

import { useThemeCustomizer } from "./theme-customizer-provider";
import { AppSidebar } from "./app-sidebar";
import { AppTopNav } from "./app-topnav";
import { WorkspaceTopBar } from "@/components/workspace/workspace-top-bar";
import { ThemeSwitcher } from "./theme-switcher";

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
      ? "min-h-[calc(100vh-1.5rem)] text-foreground"
      : "min-h-[calc(100vh-1.5rem)] rounded-2xl border border-border bg-panel text-panel-foreground shadow-sm";

  if (layout === "topnav") {
    return (
      <div className="flex min-h-screen flex-col ">
        <AppTopNav />
        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            <div className={containerClasses}>{children}</div>
          </div>
        </main>
      </div>
    );
  }

  // Default Sidebar Layout
  return (
    <div className="flex min-h-screen ">
      <AppSidebar />
      <main className="min-w-0 flex-1 p-3 pl-3 md:pl-0">
        <div className={sidebarContainerClasses}>
          <WorkspaceTopBar />
          {children}
        </div>
      </main>
    </div>
  );
}
