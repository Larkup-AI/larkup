"use client";

import { useThemeCustomizer, PanelBgVariant } from "./theme-customizer-provider";
import { AppSidebar } from "./app-sidebar";
import { AppTopNav } from "./app-topnav";
import { usePathname } from "next/navigation";
import { WorkspaceTopBar } from "@/components/workspace/workspace-top-bar";
import { cn } from "@/lib/utils";

/** Maps panel-bg variant to a CSS color for the content panel */
const PANEL_BG_COLORS: Record<PanelBgVariant, string | null> = {
  "panel-default": "#FAFAFA",
  "panel-white": "#FFFFFF",
  "panel-fafafa": "#F4F4F4",
  "panel-warm": "#F7F1EA",
  "panel-soft": "#FBFAF8",
  "panel-silver": "#F8F8F8",
  "panel-stone": "#F5F5F2",
};

export function ClientLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const { layout, pageStyle, panelBg } = useThemeCustomizer();
  const pathname = usePathname();
  const isChatPage = pathname?.includes("/chat");

  const panelColor = PANEL_BG_COLORS[panelBg];
  const panelStyle = panelColor ? { backgroundColor: panelColor } : undefined;

  const containerClasses =
    pageStyle === "fused"
      ? "min-h-[calc(100vh-8rem)] bg-background text-foreground"
      : "min-h-[calc(100vh-8rem)] rounded-2xl border border-border bg-panel text-panel-foreground";

  const sidebarContainerClasses =
    pageStyle === "fused"
      ? "min-h-[calc(100vh-1.5rem)] flex flex-col bg-background text-foreground"
      : "min-h-[calc(100vh-1.5rem)] flex flex-col rounded-2xl border border-border bg-panel text-panel-foreground overflow-hidden";

  if (layout === "topnav") {
    return (
      <div className="flex min-h-screen flex-col">
        {/* Full width header */}
        <AppTopNav />
        {/* Main layout container */}
        <main className={cn("flex-1 p-4 md:p-6 lg:p-8", isChatPage && "h-[calc(100vh-4rem)]")}>
          <div className={cn(containerClasses, "container mx-auto", isChatPage && "h-full overflow-hidden")} style={panelStyle}>
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
        <div className={sidebarContainerClasses} style={panelStyle}>
          {/* Full width (inside sidebar content area) top bar */}
          <WorkspaceTopBar />
          {/* Main layout container */}
          <div className={cn("flex-1", isChatPage ? "overflow-hidden" : "overflow-auto")}>
            <div className={cn("container mx-auto", isChatPage ? "h-full" : "pb-8")}>{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
