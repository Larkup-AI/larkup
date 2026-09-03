'use client';

import { useThemeCustomizer } from './theme-customizer-provider';
import { UnifiedSidebar } from './sidebar';
import { AppTopNav } from './topnav';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useProject } from '@/components/projects/project-provider';
import { WelcomeScreen } from '@/components/onboarding/welcome-screen';

export function ClientLayoutWrapper({ children }: { children: React.ReactNode }) {
  const { layout } = useThemeCustomizer();
  const pathname = usePathname();
  const isChatPage = pathname?.includes('/chat');
  const { isFirstRun, isLoading } = useProject();

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

  const mainClasses = 'min-w-0 flex-1 overflow-hidden';

  const containerClasses =
    'h-screen flex flex-col border-l border-border/90 bg-background text-foreground overflow-hidden';

  const isTopNav = layout === 'topnav';

  if (isTopNav) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <AppTopNav />
        <main className="min-w-0 flex-1 overflow-hidden">
          <div className="h-full flex flex-col bg-background text-foreground">
            <div
              className={cn(
                'flex-1 min-h-0',
                isChatPage || pathname?.includes('/settings') || pathname?.includes('/analytics')
                  ? 'overflow-hidden flex flex-col'
                  : 'overflow-auto',
              )}
            >
              <div
                className={cn(
                  'h-full w-full',
                  isChatPage || pathname?.includes('/settings') || pathname?.includes('/analytics')
                    ? 'flex-1 min-h-0 flex flex-col'
                    : 'container mx-auto pb-8',
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
      <main className={mainClasses}>
        <div className={containerClasses}>
          <div
            className={cn(
              'flex-1 min-h-0',
              isChatPage || pathname?.includes('/settings') || pathname?.includes('/analytics')
                ? 'overflow-hidden flex flex-col'
                : 'overflow-auto',
            )}
          >
            <div
              className={cn(
                'h-full w-full',
                isChatPage || pathname?.includes('/settings') || pathname?.includes('/analytics')
                  ? 'flex-1 min-h-0 flex flex-col'
                  : 'container mx-auto pb-8',
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
