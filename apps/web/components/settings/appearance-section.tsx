'use client';

import {
  useThemeCustomizer,
  type ThemeVariant,
  type LayoutVariant,
} from '@/components/theme-customizer-provider';
import { useTheme } from 'next-themes';
import { Check, Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

const THEMES: { id: ThemeVariant; name: string; color: string; description: string }[] = [
  { id: 'default', name: 'Default', color: '#000000', description: 'Clean & minimal gray palette' },
  {
    id: 'theme-larkup',
    name: 'Larkup',
    color: '#F3C751',
    description: 'Warm golden palette inspired by the lark',
  },
  {
    id: 'theme-gaia',
    name: 'Gaia',
    color: '#0A0A0A',
    description: 'Earthy, elegant, and grounded palette',
  },
];

const LAYOUTS: { id: LayoutVariant; name: string; description: string }[] = [
  { id: 'sidebar', name: 'Sidebar Navigation', description: 'Classic left sidebar layout' },
  { id: 'topnav', name: 'Top Navigation', description: 'Horizontal navigation bar' },
];

export function AppearanceSection() {
  const { theme, setTheme, layout, setLayout, isMounted } = useThemeCustomizer();

  const { theme: colorMode, setTheme: setColorMode } = useTheme();

  if (!isMounted) return null;

  return (
    <div className="space-y-10 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Appearance</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the look and feel of your workspace.
        </p>
      </div>

      {/* Theme Selection */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold border-b pb-2">Theme</h3>
        <div className="grid grid-cols-2 gap-3">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={cn(
                'relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 p-5 text-sm transition-all hover:bg-muted/50',
                theme === t.id
                  ? 'border-primary bg-primary/5'
                  : 'border-transparent hover:border-border',
              )}
            >
              <div
                className="h-10 w-10 rounded-full ring-1 ring-border/30"
                style={{ background: t.color }}
              />
              {theme === t.id && <Check className="absolute top-2 right-2 size-4 text-primary" />}
              <div className="text-center">
                <span className="font-semibold block">{t.name}</span>
                <span className="text-xs text-muted-foreground">{t.description}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Color Mode */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold border-b pb-2">Mode</h3>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              { id: 'light', label: 'Light', icon: Sun, description: 'Light background' },
              { id: 'dark', label: 'Dark', icon: Moon, description: 'Dark background' },
              { id: 'system', label: 'System', icon: Monitor, description: 'Follow OS' },
            ] as const
          ).map((mode) => {
            const Icon = mode.icon;
            return (
              <button
                key={mode.id}
                onClick={() => setColorMode(mode.id)}
                className={cn(
                  'relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-xs transition-all hover:bg-muted/50',
                  colorMode === mode.id
                    ? 'border-primary bg-primary/5'
                    : 'border-transparent hover:border-border',
                )}
              >
                <Icon className="size-5" />
                {colorMode === mode.id && (
                  <Check className="absolute top-1.5 right-1.5 size-3.5 text-primary" />
                )}
                <span className="font-medium">{mode.label}</span>
                <span className="text-[10px] text-muted-foreground">{mode.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation Style */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold border-b pb-2">Navigation Style</h3>
        <div className="grid grid-cols-2 gap-3">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              onClick={() => setLayout(l.id)}
              className={cn(
                'relative rounded-xl border-2 p-4 text-sm font-medium transition-all text-left',
                layout === l.id
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-transparent text-foreground hover:bg-muted/30 hover:border-border',
              )}
            >
              {layout === l.id && (
                <Check className="absolute top-2 right-2 size-3.5 text-primary" />
              )}
              <span className="font-semibold block">{l.name}</span>
              <span className="text-xs text-muted-foreground">{l.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
