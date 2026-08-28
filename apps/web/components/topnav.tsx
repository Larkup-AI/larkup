'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle, Database, Settings, Plus, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProjectSwitcher } from '@/components/projects/project-switcher';

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'chat', label: 'Chat', href: '/chat', icon: MessageCircle },
  { id: 'add', label: 'Add', href: '/add', icon: Plus },
  { id: 'data', label: 'Data', href: '/data', icon: Database },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings },
];

export function AppTopNav() {
  const pathname = usePathname();
  const username = '';

  return (
    <TooltipProvider delay={150}>
      <header
        className={cn(
          'sticky top-0 z-50 flex h-14 shrink-0 items-center gap-6 border-b border-border px-4 md:px-6 bg-sidebar',
        )}
      >
        {/* Brand */}
        <Link href="/chat" aria-label="larkup home" className="flex items-center gap-2.5 shrink-0">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground  transition-transform hover:scale-105">
            <img src="/logo9.png" className="size-5 dark:hidden" alt="logo" />
            <img src="/logo.png" className="size-5 hidden dark:block" alt="logo" />
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
              pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));

            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex items-center gap-2 h-full px-3 text-[13px] font-medium transition-colors outline-none',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" strokeWidth={active ? 2.25 : 1.75} />
                <span className="hidden md:inline">{item.label}</span>
                {/* Active underline indicator */}
                <span
                  className={cn(
                    'absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary transition-opacity',
                    active ? 'opacity-100' : 'opacity-0',
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
          <ProjectSwitcher />
          {username && (
            <span className="hidden text-sm text-muted-foreground md:block">
              Hi, <span className="font-medium text-foreground">{username}</span>
            </span>
          )}
        </div>
      </header>
    </TooltipProvider>
  );
}
