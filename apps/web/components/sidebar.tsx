'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageCircle,
  FilePlus,
  Database,
  Rocket,
  Cpu,
  Activity,
  Settings,
  ChevronLeft,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ProjectSwitcher } from '@/components/projects/project-switcher';

type IconType = React.ComponentType<{ className?: string; strokeWidth?: number }>;

function GithubMark({ className }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.74.08-.74 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.93.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  );
}

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: IconType;
  external?: boolean;
}

const WORKSPACE_ITEMS: NavItem[] = [
  { id: 'chat', label: 'Chat', href: '/chat', icon: MessageCircle },
  { id: 'add', label: 'Add Data', href: '/add', icon: FilePlus },
  { id: 'data', label: 'Data Sources', href: '/data', icon: Database },
];

const DEVELOPER_ITEMS: NavItem[] = [
  { id: 'deploy', label: 'Deploy', href: '/deploy', icon: Rocket },
  { id: 'agent', label: 'Agent Customization', href: '/agent', icon: Cpu },
];

const ACCOUNT_ITEMS: NavItem[] = [
  { id: 'monitor', label: 'Monitor', href: '/monitor', icon: Activity },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings },
];

const FOOTER_LINKS: NavItem[] = [
  {
    id: 'github',
    label: 'GitHub',
    href: 'https://github.com/Larkup-AI/larkup',
    icon: GithubMark,
    external: true,
  },
  {
    id: 'docs',
    label: 'Documentation',
    href: 'https://larkup.de/documentation',
    icon: BookOpen,
    external: true,
  },
];

type HoverState = { top: number; height: number; visible: boolean };
type HoverContextValue = {
  hoveredHref: string | null;
  enter: (href: string, element: HTMLElement) => void;
  leave: () => void;
};

const HoverContext = React.createContext<HoverContextValue>({
  hoveredHref: null,
  enter: () => undefined,
  leave: () => undefined,
});
const IndicatorContext = React.createContext<HoverState>({ top: 0, height: 36, visible: false });

function HoverProvider({
  children,
  containerRef,
}: {
  children: React.ReactNode;
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<HoverState>({ top: 0, height: 36, visible: false });
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const enter = React.useCallback(
    (href: string, element: HTMLElement) => {
      if (timer.current) clearTimeout(timer.current);
      const container = containerRef.current;
      if (!container) return;
      const parent = container.getBoundingClientRect();
      const child = element.getBoundingClientRect();
      setHoveredHref(href);
      setIndicator({
        top: child.top - parent.top + container.scrollTop,
        height: child.height,
        visible: true,
      });
    },
    [containerRef],
  );

  const leave = React.useCallback(() => {
    timer.current = setTimeout(() => {
      setHoveredHref(null);
      setIndicator((current) => ({ ...current, visible: false }));
    }, 80);
  }, []);

  return (
    <HoverContext.Provider value={{ hoveredHref, enter, leave }}>
      <IndicatorContext.Provider value={indicator}>{children}</IndicatorContext.Provider>
    </HoverContext.Provider>
  );
}

function HoverIndicator() {
  const indicator = React.useContext(IndicatorContext);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 right-0 z-0 rounded-md bg-sidebar-accent dark:bg-white/[0.07]"
      style={{
        top: indicator.top,
        height: indicator.height,
        opacity: indicator.visible ? 1 : 0,
        transition: 'top 160ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 100ms ease',
      }}
    />
  );
}

function isItemActive(item: NavItem, pathname: string | null): boolean {
  if (item.external) return false;
  return (
    pathname === item.href ||
    (item.href !== '/' && !!pathname?.startsWith(`${item.href}/`)) ||
    (item.href === '/chat' && pathname === '/')
  );
}

export function UnifiedSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(true);
  const contentRef = React.useRef<HTMLElement>(null);
  const edgeRef = React.useRef<HTMLButtonElement>(null);
  const [edgeY, setEdgeY] = useState<number | null>(null);
  const [isEdgeHovered, setIsEdgeHovered] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved === 'false') setCollapsed(false);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  };

  const updateEdgeY = React.useCallback((clientY: number) => {
    if (!edgeRef.current) return;
    const rect = edgeRef.current.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    const minY = 32;
    const maxY = Math.max(minY, rect.height - 32);
    setEdgeY(Math.max(minY, Math.min(maxY, relativeY)));
    setIsEdgeHovered(true);
  }, []);

  return (
    <TooltipProvider delay={150}>
      <aside
        className={cn(
          'group/sidebar sticky top-0 hidden h-screen shrink-0 flex-col self-start pt-4 md:flex transition-[width] duration-300 ease-in-out bg-sidebar text-sidebar-foreground',
          collapsed ? 'w-18' : 'w-60',
        )}
      >
        <div
          className={cn(
            'flex w-full items-center mb-5',
            collapsed ? 'justify-center px-3' : 'px-4',
          )}
        >
          <Link
            href="/chat"
            aria-label="Larkup"
            className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-2.5')}
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-transform hover:scale-105">
              <img src="/logo9.png" className="size-5 dark:hidden" alt="logo" />
              <img src="/logo.png" className="size-5 hidden dark:block" alt="logo" />
            </span>
            {!collapsed && (
              <span className="text-sm font-semibold tracking-tight text-foreground">Larkup</span>
            )}
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-1.5">
          <HoverProvider containerRef={contentRef}>
            <nav ref={contentRef} className="relative flex flex-col gap-6 pb-4">
              <HoverIndicator />
              <NavGroup items={WORKSPACE_ITEMS} pathname={pathname} collapsed={collapsed} />
              <NavGroup
                items={DEVELOPER_ITEMS}
                pathname={pathname}
                collapsed={collapsed}
                label="Developer"
              />
              <NavGroup
                items={ACCOUNT_ITEMS}
                pathname={pathname}
                collapsed={collapsed}
                label="Account"
              />
            </nav>
          </HoverProvider>
        </div>

        <div className="mt-auto flex w-full flex-col">
          <div
            className={cn(
              'flex flex-col gap-0.5 pt-3 pb-2',
              collapsed ? 'items-center px-2' : 'px-3',
            )}
          >
            {FOOTER_LINKS.map((item) => (
              <FooterLink key={item.id} item={item} collapsed={collapsed} />
            ))}
          </div>
          <ProjectSwitcher collapsed={collapsed} />
        </div>

        <button
          ref={edgeRef}
          type="button"
          onClick={toggleCollapsed}
          onMouseEnter={(e) => updateEdgeY(e.clientY)}
          onMouseMove={(e) => updateEdgeY(e.clientY)}
          onMouseLeave={() => setIsEdgeHovered(false)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="group/edge absolute inset-y-0 -right-2.5 z-50 flex w-5 cursor-pointer items-start justify-center outline-none"
        >
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors duration-150',
              isEdgeHovered ? 'bg-neutral-300 dark:bg-neutral-700' : 'bg-transparent',
            )}
          />
          <span
            className={cn(
              'absolute left-1/2 -translate-x-1/2 -translate-y-1/2 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm transition-[opacity,color,transform] duration-150 group-hover/edge:text-foreground group-focus-visible/edge:text-foreground',
              isEdgeHovered ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none',
              'group-focus-visible/edge:opacity-100 group-focus-visible/edge:pointer-events-auto',
            )}
            style={{ top: edgeY !== null ? `${edgeY}px` : '50%' }}
          >
            <ChevronLeft
              className={cn(
                'size-3.5 transition-transform duration-200',
                collapsed && 'rotate-180',
              )}
            />
          </span>
        </button>
      </aside>
    </TooltipProvider>
  );
}

function NavGroup({
  items,
  pathname,
  collapsed,
  label,
}: {
  items: NavItem[];
  pathname: string | null;
  collapsed: boolean;
  label?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', collapsed && 'items-center')}>
      {!collapsed && label && (
        <span className="px-2.5 pb-1 text-[12.5px] font-medium text-muted-foreground/70">
          {label}
        </span>
      )}
      {items.map((item) => (
        <NavLink key={item.id} item={item} pathname={pathname} collapsed={collapsed} />
      ))}
    </div>
  );
}

function NavLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string | null;
  collapsed: boolean;
}) {
  const { hoveredHref, enter, leave } = React.useContext(HoverContext);
  const ref = React.useRef<HTMLAnchorElement>(null);
  const Icon = item.icon;
  const active = isItemActive(item, pathname);
  const hovered = hoveredHref === item.href;

  const handleClick = (e: React.MouseEvent) => {
    if (item.id === 'chat' && pathname === '/chat') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('new-chat'));
    }
  };

  const link = (
    <Link
      ref={ref}
      href={item.href}
      aria-current={active ? 'page' : undefined}
      onClick={handleClick}
      onMouseEnter={() => ref.current && enter(item.href, ref.current)}
      onMouseLeave={leave}
      className={cn(
        'relative z-10 flex h-9 w-full items-center gap-3 rounded-md px-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        collapsed && 'w-10 justify-center px-0',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground dark:bg-white/[0.07] dark:text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon
        strokeWidth={1.75}
        className={cn(
          'size-4 shrink-0 transition-colors',
          active || hovered ? 'text-foreground' : 'text-muted-foreground',
        )}
      />
      {!collapsed && (
        <span
          className={cn(
            'truncate text-[14px] font-medium leading-5 tracking-[-0.01em] transition-colors',
            active || hovered ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {item.label}
        </span>
      )}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger render={link} />
        <TooltipContent side="right" sideOffset={10}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

function FooterLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  const link = (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'flex h-8 items-center gap-3 rounded-md px-2.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        collapsed ? 'w-10 justify-center px-0' : 'w-full',
      )}
    >
      <Icon strokeWidth={1.75} className="size-4 shrink-0" />
      {!collapsed && (
        <span className="truncate text-[13px] font-medium leading-5 tracking-[-0.01em]">
          {item.label}
        </span>
      )}
    </a>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger render={link} />
        <TooltipContent side="right" sideOffset={10}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}
