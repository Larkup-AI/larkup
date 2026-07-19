"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageCircle,
  Database,
  Settings,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TooltipProvider,
} from "@/components/ui/tooltip";
import { ServerSwitcher } from "@/components/workspace/server-switcher";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { useThemeCustomizer, type PanelBgVariant } from "./theme-customizer-provider";

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
}

const NAV_ITEMS: NavItem[] = [
  { id: "chat", label: "Chat", href: "/chat", icon: MessageCircle },
  { id: "data", label: "Data", href: "/data", icon: Database },
  { id: "analytics", label: "Analytics", href: "/analytics", icon: BarChart3 },
  { id: "settings", label: "Settings", href: "/settings", icon: Settings },
];

export function AppTopNav() {
  const pathname = usePathname();
  const { username } = useWorkspace();
  const { navBg } = useThemeCustomizer();

  const navColor = navBg ? NAV_BG_COLORS[navBg] : undefined;
  const navStyle = navColor ? { backgroundColor: navColor } : undefined;

  return (
    <TooltipProvider delay={150}>
      <header
        className={cn(
          "sticky top-0 z-50 flex h-14 shrink-0 items-center gap-6 border-b border-border px-4 md:px-6",
          !navColor ? "bg-[#F5F5F4]" : "",
        )}
        style={navStyle}
      >
        {/* Brand */}
        <Link
          href="/chat"
          aria-label="larkup home"
          className="flex items-center gap-2.5 shrink-0"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105">
            <img src="/logo9.png" className="size-5" alt="logo" />
          </span>
          <span className="font-semibold tracking-tight text-foreground hidden sm:inline-block">
            Larkup
          </span>
        </Link>

        {/* Navigation items */}
        <nav className="flex h-full items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname?.startsWith(item.href));

            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-2 h-full px-3 text-[13px] font-medium transition-colors outline-none",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon
                  className="size-[16px]"
                  strokeWidth={active ? 2.25 : 1.75}
                />
                <span className="hidden md:inline">{item.label}</span>
                {/* Active underline indicator */}
                <span
                  className={cn(
                    "absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-primary transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
              </Link>
            );
          })}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side */}
        <div className="flex items-center gap-3">
          <ServerSwitcher />
          {username && (
            <span className="hidden text-sm text-muted-foreground md:block">
              Hi,{" "}
              <span className="font-medium text-foreground">{username}</span>
            </span>
          )}
        </div>
      </header>
    </TooltipProvider>
  );
}
