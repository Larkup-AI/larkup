"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileStack,
  FlaskConical,
  Layers,
  Lock,
  type LucideIcon,
  MessageCircle,
  Server,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGES, CURRENT_PHASE } from "@larkup-rag/core/stages";
import type { StageId } from "@larkup-rag/core/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useThemeCustomizer, type PanelBgVariant } from "./theme-customizer-provider";
import { ThemeSwitcher } from "./theme-switcher";

const NAV_BG_COLORS: Record<PanelBgVariant, string | undefined> = {
  "panel-default": undefined,
  "panel-white": "#FFFFFF",
  "panel-fafafa": "#F4F4F4",
  "panel-warm": "#F7F1EA",
  "panel-soft": "#FBFAF8",
  "panel-silver": "#F8F8F8",
  "panel-stone": "#F5F5F2",
};

// [#CDA1FE]
const STAGE_ICONS: Record<StageId, LucideIcon> = {
  configure: SlidersHorizontal,
  data: FileStack,
  index: Layers,
  server: Server,
  demo: FlaskConical,
  chat: MessageCircle,
};

export function AppSidebar() {
  const pathname = usePathname();
  const { pageStyle, navBg } = useThemeCustomizer();

  const navColor = navBg ? NAV_BG_COLORS[navBg] : undefined;
  const navStyle = navColor ? { backgroundColor: navColor } : undefined;

  return (
    <TooltipProvider delay={150}>
      <aside
        className={cn(
          "sticky top-0 hidden h-screen w-[84px] shrink-0 flex-col items-center gap-1 self-start py-3 md:flex",
          !navColor ? "bg-background" : "",
          pageStyle === "fused" ? "border-r border-border" : "",
        )}
        style={navStyle}
      >
        {/* Brand */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href="/configure"
                aria-label="larkup-rag home"
                className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105"
              />
            }
          >
            {/* <Boxes className="size-5" /> */}
            <img src={"/logo9.png"} className="size-6.5" alt="logo" />
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            Larkup RAG
          </TooltipContent>
        </Tooltip>

        {/* Pipeline rail */}
        <nav className="flex flex-1 flex-col items-center gap-1.5">
          {STAGES.map((stage) => {
            const Icon = STAGE_ICONS[stage.id];
            const active =
              pathname === stage.href ||
              (stage.href === "/configure" && pathname === "/");
            const locked = stage.phase > CURRENT_PHASE;

            const body = (
              <>
                {/* active accent bar (Teams-style) */}
                <span
                  className={cn(
                    "absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <span
                  className={cn(
                    "relative flex size-10 items-center justify-center rounded-xl transition-colors",
                    active
                      ? "bg-white border text-primary"
                      : locked
                        ? "text-muted-foreground/50"
                        : "text-foreground/70 group-hover:bg-white/90 group-hover:text-foreground",
                  )}
                >
                  <Icon
                    className="size-[19px]"
                    strokeWidth={active ? 2.25 : 2}
                  />
                  {locked && (
                    <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-background">
                      <Lock className="size-2.5 text-muted-foreground" />
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "text-[10.5px] leading-none tracking-tight",
                    active
                      ? "font-semibold text-primary"
                      : locked
                        ? "text-muted-foreground/50"
                        : "text-muted-foreground",
                  )}
                >
                  {stage.label}
                </span>
              </>
            );

            return (
              <Tooltip key={stage.id}>
                <TooltipTrigger
                  render={
                    locked ? (
                      <div
                        aria-disabled
                        className="group relative flex w-16 cursor-not-allowed flex-col items-center gap-1.5 rounded-2xl py-2"
                      />
                    ) : (
                      <Link
                        href={stage.href}
                        aria-current={active ? "page" : undefined}
                        className="group relative flex w-16 flex-col items-center gap-1.5 rounded-2xl py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    )
                  }
                >
                  {body}
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={10}
                  className="max-w-56"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {stage.label}
                      {locked && (
                        <span className="ml-1.5 font-mono text-[10px] opacity-70">
                          Phase {stage.phase}
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] leading-snug opacity-80">
                      {locked
                        ? `Unlocks in Phase ${stage.phase}.`
                        : stage.description}
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Footer — dual-mode indicator */}
        <ThemeSwitcher floating={false} />
      </aside>
    </TooltipProvider>
  );
}
