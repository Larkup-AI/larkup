'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageCircle,
  Database,
  Settings,
  BarChart3,
  ChevronLeft,
  Server,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useThemeCustomizer, type PanelBgVariant } from '@/components/theme-customizer-provider';
import { ServerSwitcher } from '@/components/workspace/server-switcher';
import { useWorkspace } from '@/components/workspace/workspace-provider';

const NAV_BG_COLORS: Record<PanelBgVariant, string | undefined> = {
  'panel-default': undefined,
  'panel-white': '#FFFFFF',
  'panel-fafafa': '#FAFAFA',
  'panel-warm': '#F7F1EA',
  'panel-soft': '#FBFAF8',
  'panel-silver': '#F8F8F8',
  'panel-stone': '#F5F5F2',
};

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'chat', label: 'Chat', href: '/chat', icon: MessageCircle },
  { id: 'data', label: 'Data', href: '/data', icon: Database },
  { id: 'analytics', label: 'Analytics', href: '/analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings },
];

export function UnifiedSidebar() {
  const pathname = usePathname();
  const { pageStyle, navBg } = useThemeCustomizer();
  const { activeServer } = useWorkspace();
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved === 'false') setCollapsed(false);
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar-collapsed', String(next));
  };

  const navColor = navBg ? NAV_BG_COLORS[navBg] : undefined;
  const navStyle = navColor ? { backgroundColor: navColor } : undefined;

  return (
    <TooltipProvider delay={150}>
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col self-start py-4 md:flex transition-all duration-300 ease-in-out',
          collapsed ? 'w-[72px]' : 'w-[240px]',
          !navColor ? 'bg-background' : '',
          pageStyle === 'fused' ? 'border-r border-border' : '',
        )}
        style={navStyle}
      >
        <div
          className={cn(
            'flex w-full items-center mb-6',
            collapsed ? 'justify-center px-3' : 'justify-between px-4',
          )}
        >
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={toggleCollapsed}
                    aria-label="Expand sidebar"
                    className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground  transition-transform hover:scale-105"
                  />
                }
              >
                <img src="/logo9.png" className="size-5" alt="logo" />
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={10}>
                Expand sidebar
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
              <Link href="/chat" className="flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground  transition-transform hover:scale-105">
                  <img src="/logo9.png" className="size-5" alt="logo" />
                </span>
                <span className="text-sm font-semibold tracking-tight text-foreground">Larkup</span>
              </Link>
              <button
                onClick={toggleCollapsed}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft className="size-3.5" />
              </button>
            </>
          )}
        </div>

        <nav
          className={cn(
            'flex flex-1 flex-col w-full',
            collapsed ? 'items-center px-3 gap-3' : 'px-3 gap-1.5',
          )}
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));

            if (collapsed) {
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger
                    render={
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'group relative flex size-10 items-center justify-center rounded-xl transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          active
                            ? 'bg-[#F0F0F0] text-foreground'
                            : 'text-muted-foreground hover:bg-[#EBEBEB] hover:text-foreground',
                        )}
                      />
                    }
                  >
                    <Icon className="size-[18px]" strokeWidth={active ? 2.25 : 1.75} />
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={10}>
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-[#F0F0F0] text-foreground'
                    : 'text-muted-foreground hover:bg-[#EBEBEB] hover:text-foreground',
                )}
              >
                <Icon className="size-[18px] shrink-0" strokeWidth={active ? 2.25 : 1.75} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={cn('w-full pt-3', collapsed ? 'px-2' : 'px-3')}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={toggleCollapsed}
                    className="flex w-full items-center justify-center py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  />
                }
              >
                <div className="relative size-8 rounded-lg border border-border bg-card flex items-center justify-center  text-muted-foreground transition-colors group-hover:text-foreground">
                  <Server className="size-4" />
                  <span className="absolute -bottom-0.5 -right-0.5 flex size-2.5">
                    {activeServer?.running ? (
                      <>
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                        <span className="relative inline-flex size-full rounded-full bg-green-500 border border-card" />
                      </>
                    ) : (
                      <span className="relative inline-flex size-full rounded-full bg-red-500 border border-card" />
                    )}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={10}>
                {activeServer?.name ?? 'No server'} ({activeServer?.running ? 'Live' : 'Offline'})
              </TooltipContent>
            </Tooltip>
          ) : (
            <ServerSwitcher />
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
