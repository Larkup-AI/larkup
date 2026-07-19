'use client';

import { useThemeCustomizer, PanelBgVariant } from './theme-customizer-provider';
import { UnifiedSidebar } from './unified-sidebar';
import { AppTopNav } from './app-topnav';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { WelcomeScreen } from '@/components/onboarding/welcome-screen';

const PANEL_BG_COLORS: Record<PanelBgVariant, string | null> = {
  'panel-default': '#FAFAFA',
  'panel-white': '#FFFFFF',
  'panel-fafafa': '#FAFAFA',
  'panel-warm': '#F7F1EA',
  'panel-soft': '#FBFAF8',
  'panel-silver': '#F8F8F8',
  'panel-stone': '#F5F5F2',
};

export function ClientLayoutWrapper({ children }: { children: React.ReactNode }) {
  const { pageStyle, panelBg, layout } = useThemeCustomizer();
  const pathname = usePathname();
  const isChatPage = pathname?.includes('/chat');
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

  const mainClasses = 'min-w-0 flex-1 overflow-hidden';

  const containerClasses =
    pageStyle === 'fused'
      ? 'h-screen flex flex-col bg-background text-foreground overflow-hidden'
      : 'h-screen flex flex-col md:rounded-l-2xl border-l border-border bg-panel text-panel-foreground overflow-hidden';

  const isTopNav = layout === 'topnav';

  if (isTopNav) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <AppTopNav />
        <main className="min-w-0 flex-1 overflow-hidden">
          <div className="h-full flex flex-col bg-background text-foreground" style={panelStyle}>
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
        <div className={containerClasses} style={panelStyle}>
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
