'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { GlobalSettings } from './global-settings';

import { useThemeCustomizer, type ThemeVariant } from './theme-customizer-provider';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import {
  SlidersHorizontal,
  Palette,
  User,
  Check,
  Settings,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';

const THEMES: { id: ThemeVariant; name: string; color: string; description: string }[] = [
  { id: 'default', name: 'Default', color: '#000000', description: 'Clean & minimal' },
  { id: 'theme-larkup', name: 'Larkup', color: '#F3C751', description: 'Warm & golden' },
];

export function ThemeSwitcher({ floating = true }: { floating?: boolean }) {
  return (
    <Suspense
      fallback={<div className={floating ? 'fixed bottom-6 right-6 z-50 h-12 w-12' : 'size-9'} />}
    >
      <ThemeSwitcherContent floating={floating} />
    </Suspense>
  );
}

function ThemeSwitcherContent({ floating = true }: { floating?: boolean }) {
  const { theme, setTheme, isMounted } = useThemeCustomizer();

  const { theme: colorMode, setTheme: setColorMode } = useTheme();
  const { username, setUsername } = useWorkspace();

  const [localName, setLocalName] = useState(username || '');

  const syncedRef = useState({ synced: false })[0];
  if (isMounted && !syncedRef.synced && username && localName !== username) {
    setLocalName(username);
    syncedRef.synced = true;
  }

  const searchParams = useSearchParams();
  const [view, setView] = useState<'main' | 'settings'>('main');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (searchParams?.get('settings')) {
      setOpen(true);
      setView('settings');
    }
  }, [searchParams]);

  const handleSaveUsername = () => {
    setUsername(localName.trim());
  };

  if (!isMounted) return null;

  const wrapperClass = floating ? 'fixed bottom-6 right-6 z-50' : 'flex items-center';
  const buttonClass = floating
    ? 'h-12 w-12 rounded-full '
    : 'size-9 rounded-lg border border-border bg-card text-primary  hover:bg-accent hover:text-accent-foreground';

  return (
    <div className={wrapperClass}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant={floating ? 'default' : 'ghost'} size="icon" className={buttonClass}>
              <SlidersHorizontal className={floating ? 'h-5 w-5' : 'h-4 w-4'} />
            </Button>
          }
        />
        <PopoverContent
          align="end"
          className="w-80 p-0  flex flex-col max-h-[85vh] overflow-hidden"
        >
          {view === 'settings' ? (
            <div className="flex flex-col min-h-0 flex-1 h-full animate-in slide-in-from-right-4 duration-300">
              <GlobalSettings onBack={() => setView('main')} />
            </div>
          ) : (
            <div className="flex flex-col min-h-0 flex-1 h-full animate-in slide-in-from-left-4 duration-300">
              <div className="border-b px-4 py-3 font-semibold flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Palette className="h-4 w-4" /> Preferences
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setView('settings')}
                >
                  <Settings className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
              <div className="flex-1 min-h-0 p-4 space-y-6 overflow-y-auto">
                {/* Username */}
                <div className="space-y-3">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" /> Username
                  </label>
                  <div className="flex gap-2">
                    <Input
                      value={localName}
                      onChange={(e) => setLocalName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveUsername()}
                      placeholder="Enter your name"
                      className="flex-1 rounded-md border border-input bg-background px-3 h-7 text-sm outline-none "
                    />
                    <Button
                      size="sm"
                      variant="default"
                      className="shrink-0 h-7 px-3.5"
                      onClick={handleSaveUsername}
                    >
                      save
                    </Button>
                  </div>
                </div>

                {/* Color Theme */}
                <div className="space-y-3">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Palette className="h-4 w-4 text-muted-foreground" /> Theme
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {THEMES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTheme(t.id)}
                        className={cn(
                          'relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-3 text-xs transition-all hover:bg-muted/50',
                          theme === t.id
                            ? 'border-primary bg-primary/5'
                            : 'border-transparent hover:border-border',
                        )}
                      >
                        <div
                          className="h-8 w-8 rounded-full ring-1 ring-border/30"
                          style={{ background: t.color }}
                        />
                        {theme === t.id && (
                          <Check className="absolute top-1.5 right-1.5 size-3.5 text-primary" />
                        )}
                        <span className="font-medium">{t.name}</span>
                        <span className="text-[10px] text-muted-foreground">{t.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color Mode (Light/Dark/System) */}
                <div className="space-y-3">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-muted-foreground" /> Mode
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'light', label: 'Light', icon: Sun },
                        { id: 'dark', label: 'Dark', icon: Moon },
                        { id: 'system', label: 'System', icon: Monitor },
                      ] as const
                    ).map((mode) => {
                      const Icon = mode.icon;
                      return (
                        <button
                          key={mode.id}
                          onClick={() => setColorMode(mode.id)}
                          className={cn(
                            'flex flex-col items-center gap-1.5 rounded-lg border-2 p-2.5 text-xs transition-all hover:bg-muted/50',
                            colorMode === mode.id
                              ? 'border-primary bg-primary/5'
                              : 'border-transparent hover:border-border',
                          )}
                        >
                          <Icon className="size-4" />
                          <span className="font-medium">{mode.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
