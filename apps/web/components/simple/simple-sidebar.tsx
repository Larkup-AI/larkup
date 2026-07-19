"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageCircle,
  FileStack,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useThemeCustomizer,
  type PanelBgVariant,
} from "@/components/theme-customizer-provider";
import { ThemeSwitcher } from "@/components/theme-switcher";

const NAV_BG_COLORS: Record<PanelBgVariant, string | undefined> = {
  "panel-default": undefined,
  "panel-white": "#FFFFFF",
  "panel-fafafa": "#FAFAFA",
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

export function SimpleSidebar() {
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
                href="/simple/chat"
                aria-label="larkup home"
                className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105"
              />
            }
          >
            <img src={"/logo9.png"} className="size-6.5" alt="logo" />
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            Larkup
          </TooltipContent>
        </Tooltip>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col items-center gap-2.5">
          {SIMPLE_NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname?.startsWith(item.href);

            return (
              <Tooltip key={item.id}>
                <TooltipTrigger
                  render={
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className="group relative flex w-16 flex-col items-center gap-0.5 rounded-2xl py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  }
                >
                  {/* Active accent bar */}
                  <span
                    className={cn(
                      "absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
                      active ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span
                    className={cn(
                      "relative flex size-9 items-center justify-center rounded-xl transition-colors",
                      active
                        ? "bg-white border text-primary"
                        : "text-foreground/70 group-hover:bg-white/90 group-hover:text-foreground",
                    )}
                  >
                    <Icon
                      className="size-[19px]"
                      strokeWidth={active ? 2.25 : 2}
                    />
                  </span>
                  <span
                    className={cn(
                      "text-[10px] leading-none tracking-tight",
                      active
                        ? "font-semibold text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {item.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={10}
                  className="max-w-56"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{item.label}</span>
                    <span className="text-[11px] leading-snug opacity-80">
                      {item.description}
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Footer */}
        <ThemeSwitcher floating={false} />
      </aside>
    </TooltipProvider>
  );
}
