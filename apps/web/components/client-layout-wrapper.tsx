"use client";

import {
  useThemeCustomizer,
  PanelBgVariant,
} from "./theme-customizer-provider";
import { UnifiedSidebar } from "./unified-sidebar";
import { AppTopNav } from "./app-topnav";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { WelcomeScreen } from "@/components/onboarding/welcome-screen";

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
  const { pageStyle, panelBg, layout } = useThemeCustomizer();
  const pathname = usePathname();
  const isChatPage = pathname?.includes("/chat");
  const { isFirstRun, isLoading } = useWorkspace();

  const panelColor = PANEL_BG_COLORS[panelBg];
  const panelStyle = panelColor ? { backgroundColor: panelColor } : undefined;

  if (!isLoading && isFirstRun) {
    return <WelcomeScreen />;
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const sidebarContainerClasses =
    pageStyle === "fused"
      ? "h-[calc(100vh-1.5rem)] flex flex-col bg-background text-foreground overflow-hidden"
      : "h-[calc(100vh-1.5rem)] flex flex-col rounded-2xl border border-border bg-panel text-panel-foreground overflow-hidden";

  const isTopNav = layout === "topnav";

  if (isTopNav) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <AppTopNav />
        <main className="min-w-0 flex-1 overflow-hidden">
          <div className="h-full flex flex-col bg-background text-foreground" style={panelStyle}>
            <div
              className={cn(
                "flex-1 min-h-0",
                (isChatPage || pathname?.includes("/settings")) ? "overflow-hidden flex flex-col" : "overflow-auto",
              )}
            >
              <div
                className={cn(
                  "h-full w-full",
                  (isChatPage || pathname?.includes("/settings")) ? "flex-1 min-h-0 flex flex-col" : "container mx-auto pb-8",
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

  return (
    <div className="flex h-screen overflow-hidden">
      <UnifiedSidebar />
      <main className="min-w-0 flex-1 p-3 pl-3 md:pl-0 overflow-hidden">
        <div className={sidebarContainerClasses} style={panelStyle}>
          <div
            className={cn(
              "flex-1 min-h-0",
              (isChatPage || pathname?.includes("/settings")) ? "overflow-hidden flex flex-col" : "overflow-auto",
            )}
          >
            <div
              className={cn(
                "h-full w-full",
                (isChatPage || pathname?.includes("/settings")) ? "flex-1 min-h-0 flex flex-col" : "container mx-auto pb-8",
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
