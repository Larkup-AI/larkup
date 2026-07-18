"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { useThemeCustomizer, type PanelBgVariant } from "@/components/theme-customizer-provider";
import { MessageCircle, FileStack, SlidersHorizontal, type LucideIcon } from "lucide-react";

const NAV_BG_COLORS: Record<PanelBgVariant, string | undefined> = {
  "panel-default": undefined,
  "panel-white": "#FFFFFF",
  "panel-fafafa": "#F4F4F4",
  "panel-warm": "#F7F1EA",
  "panel-soft": "#FBFAF8",
  "panel-silver": "#F8F8F8",
  "panel-stone": "#F5F5F2",
};

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
}

const SIMPLE_NAV: NavItem[] = [
  {
    id: "chat",
    label: "Chat",
    href: "/simple/chat",
    icon: MessageCircle,
    description: "Chat with your knowledge base using AI.",
  },
  {
    id: "docs",
    label: "Docs",
    href: "/simple/docs",
    icon: FileStack,
    description: "Upload, paste, or manage your documents.",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/simple/settings",
    icon: SlidersHorizontal,
    description: "Configure provider, API keys, and advanced settings.",
  },
];

export function SimpleTopNav() {
  const pathname = usePathname();
  const { username } = useWorkspace();
  const { navBg } = useThemeCustomizer();

  const navColor = navBg ? NAV_BG_COLORS[navBg] : undefined;
  const navStyle = navColor ? { backgroundColor: navColor } : undefined;

  return (
    <TooltipProvider delay={150}>
      <header
        className={cn(
          "sticky top-0 z-50 flex h-16 shrink-0 items-center gap-4 border-b border-border px-4 md:px-6",
          !navColor ? "bg-white" : "",
        )}
        style={navStyle}
      >
        {/* Brand */}
        <Link
          href="/simple/chat"
          aria-label="larkup home"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105"
        >
          <img src={"/logo9.png"} className="size-5" alt="logo" />
        </Link>
        <span className="font-semibold tracking-tight hidden sm:inline-block">
          Larkup
        </span>

        {/* Navigation */}
        <nav className="flex flex-1 h-full items-end pb-0 gap-2 md:gap-4 ml-4">
          {SIMPLE_NAV.map((item, index) => {
            const Icon = item.icon;
            const active = pathname?.startsWith(item.href);

            return (
              <Tooltip key={item.id}>
                <TooltipTrigger
                  render={
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-2 h-10 px-3 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active ? "bg-muted/0" : "hover:bg-muted/30",
                      )}
                    />
                  }
                >
                  <div className="flex items-center">
                    <span
                      className={cn(
                        "flex size-9 items-center justify-center rounded-lg transition-colors",
                        active
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                    >
                      <Icon
                        className="size-[18px]"
                        strokeWidth={active ? 2.25 : 2}
                      />
                    </span>
                    <span
                      className={cn(
                        "hidden md:block text-[13px] tracking-tight",
                        active
                          ? "font-semibold text-primary"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </span>
                    {/* active accent bar (bottom) */}
                    <span
                      className={cn(
                        "absolute bottom-0 left-0 h-0.5 w-full bg-primary transition-opacity",
                        active
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100",
                      )}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={10}
                  className="max-w-56"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {item.label}
                    </span>
                    <span className="text-[11px] leading-snug opacity-80">
                      {item.description}
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Right side: Workspace & Theme Customizer */}
        <div className="flex items-center gap-3">
          {username && (
            <span className="hidden text-sm text-muted-foreground md:block">
              Hi,{" "}
              <span className="font-medium text-foreground">{username}</span>
            </span>
          )}
          <ThemeSwitcher floating={false} />
        </div>
      </header>
    </TooltipProvider>
  );
}
