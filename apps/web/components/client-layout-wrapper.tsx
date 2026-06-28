"use client";

import {
  useThemeCustomizer,
  PanelBgVariant,
} from "./theme-customizer-provider";
import { AppSidebar } from "./app-sidebar";
import { AppTopNav } from "./app-topnav";
import { usePathname } from "next/navigation";
import { WorkspaceTopBar } from "@/components/workspace/workspace-top-bar";
import { cn } from "@/lib/utils";

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
      ? "h-[calc(100vh-8rem)] bg-background text-foreground overflow-hidden"
      : "h-[calc(100vh-8rem)] rounded-2xl border border-border bg-panel text-panel-foreground overflow-hidden";

  const sidebarContainerClasses =
    pageStyle === "fused"
      ? "h-[calc(100vh-1.5rem)] flex flex-col bg-background text-foreground overflow-hidden"
      : "h-[calc(100vh-1.5rem)] flex flex-col rounded-2xl border border-border bg-panel text-panel-foreground overflow-hidden";

  if (layout === "topnav") {
    return (
      <div className="flex h-screen flex-col overflow-hidden">
        <AppTopNav />
        <main
          className={cn("flex-1 min-h-0 overflow-hidden p-4 md:p-6 lg:p-8")}
        >
          <div
            className={cn(containerClasses, "container mx-auto flex flex-col")}
            style={panelStyle}
          >
            {children}
          </div>
        </main>
      </div>
    );
  }

  // Default Sidebar Layout
  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <main className="min-w-0 flex-1 p-3 pl-3 md:pl-0 overflow-hidden">
        <div className={sidebarContainerClasses} style={panelStyle}>
          <WorkspaceTopBar />
          <div
            className={cn(
              "flex-1 min-h-0",
              isChatPage ? "overflow-hidden flex flex-col" : "overflow-auto",
            )}
          >
            <div
              className={cn(
                "container mx-auto",
                isChatPage ? "flex-1 min-h-0 flex flex-col" : "pb-8",
              )}
            >
              {children}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
