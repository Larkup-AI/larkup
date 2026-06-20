"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileStack,
  Layers,
  Lock,
  type LucideIcon,
  MessageSquareText,
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
import { ServerSwitcher } from "@/components/workspace/server-switcher";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { ThemeSwitcher } from "./theme-switcher";

const STAGE_ICONS: Record<StageId, LucideIcon> = {
  configure: SlidersHorizontal,
  data: FileStack,
  index: Layers,
  server: Server,
  demo: MessageSquareText,
};

export function AppTopNav() {
  const pathname = usePathname();
  const { username } = useWorkspace();

  return (
    <TooltipProvider delay={150}>
      <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center gap-4 border-b border-border bg-background px-4 md:px-6">
        {/* Brand */}
        <Link
          href="/configure"
          aria-label="larkup-rag home"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105"
        >
          <img src={"/logo9.png"} className="size-5" alt="logo" />
        </Link>
        <span className="font-semibold tracking-tight hidden sm:inline-block">
          Larkup RAG
        </span>

        {/* Pipeline rail */}
        <nav className="flex flex-1 items-center gap-2 md:gap-4 ml-4">
          {STAGES.map((stage, index) => {
            const Icon = STAGE_ICONS[stage.id];
            const active =
              pathname === stage.href ||
              (stage.href === "/configure" && pathname === "/");
            const locked = stage.phase > CURRENT_PHASE;

            const body = (
              <>
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg transition-colors",
                    active
                      ? "text-primary"
                      : locked
                        ? "text-muted-foreground/50"
                        : "text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  <Icon
                    className="size-[18px]"
                    strokeWidth={active ? 2.25 : 2}
                  />
                  {locked && (
                    <span className="absolute -right-0.5 -top-0.5 flex size-3 items-center justify-center rounded-full bg-background">
                      <Lock className="size-2 text-muted-foreground" />
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "hidden md:block text-[13px] tracking-tight",
                    active
                      ? "font-semibold text-primary"
                      : locked
                        ? "text-muted-foreground/50"
                        : "text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  {index + 1}. {stage.label}
                </span>
                {/* active accent bar (bottom) */}
                <span
                  className={cn(
                    "absolute bottom-0 left-0 h-0.5 w-full bg-primary transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
              </>
            );

            return (
              <Tooltip key={stage.id}>
                <TooltipTrigger
                  render={
                    locked ? (
                      <div
                        aria-disabled
                        className="group relative flex cursor-not-allowed items-center gap-2 h-16 px-3 rounded-md transition-colors"
                      />
                    ) : (
                      <Link
                        href={stage.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group relative flex items-center gap-2 h-16 px-3 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active ? "bg-primary/8" : "hover:bg-muted/70",
                        )}
                      />
                    )
                  }
                >
                  {body}
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={10}
                  className="max-w-56"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {index + 1}. {stage.label}
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

        {/* Right side: Workspace & Theme Customizer */}
        <div className="flex items-center gap-3">
          <ServerSwitcher />
          {username && (
            <span className="hidden text-sm text-muted-foreground md:block">
              Hi,{" "}
              <span className="font-medium text-foreground">{username}</span>
            </span>
          )}
          <ThemeSwitcher floating={false} />{" "}
        </div>
      </header>
    </TooltipProvider>
  );
}
