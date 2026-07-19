'use client';

import {
  useThemeCustomizer,
  type ThemeVariant,
  type BackgroundVariant,
  type PanelBgVariant,
  type RadiusVariant,
  type PageStyleVariant,
  type LayoutVariant,
} from '@/components/theme-customizer-provider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const THEMES: { id: ThemeVariant; name: string; color: string }[] = [
  { id: 'default', name: 'Caffee', color: '#f2efe4' },
  { id: 'theme-gaia', name: 'Emerald Green', color: '#2b935f' },
  { id: 'theme-docker', name: 'Ocean Blue', color: '#1d63ed' },
  { id: 'theme-pinecone', name: 'Deep Indigo', color: '#6e56cf' },
  { id: 'theme-vercel', name: 'Minimal Black', color: '#000000' },
  { id: 'theme-elevenlabs', name: 'Soft Cream', color: '#f8f7f5' },
  { id: 'theme-espresso', name: 'Espresso', color: '#6B3F2A' },
  { id: 'theme-sienna', name: 'Warm Sienna', color: '#A0522D' },
  { id: 'theme-caramel', name: 'Caramel', color: '#C47C3E' },
];

const BACKGROUNDS: { id: BackgroundVariant; name: string; color: string }[] = [
  { id: 'bg-default', name: 'White', color: '#FFFFFF' },
  { id: 'bg-pure', name: 'Pure White', color: '#FFFFFF' },
  { id: 'bg-fafafa', name: 'Near White', color: '#F4F4F4' },
  { id: 'bg-silver', name: 'Silver', color: '#F8F8F8' },
  { id: 'bg-soft', name: 'Soft', color: '#FBFAF8' },
  { id: 'bg-stone', name: 'Stone', color: '#F5F5F2' },
  { id: 'bg-sage', name: 'Sage', color: '#EDEDE8' },
  { id: 'bg-warm', name: 'Warm Cream', color: '#F7F1EA' },
];

const PANEL_BACKGROUNDS: { id: PanelBgVariant; name: string; color: string }[] = [
  { id: 'panel-default', name: 'Theme Default', color: '#FAFAFA' },
  { id: 'panel-white', name: 'White', color: '#FFFFFF' },
  { id: 'panel-fafafa', name: 'Near White', color: '#F4F4F4' },
  { id: 'panel-silver', name: 'Silver', color: '#F8F8F8' },
  { id: 'panel-soft', name: 'Soft', color: '#FBFAF8' },
  { id: 'panel-stone', name: 'Stone', color: '#F5F5F2' },
  { id: 'panel-warm', name: 'Warm Cream', color: '#F7F1EA' },
];

const RADIUSES: { id: RadiusVariant; name: string; value: string }[] = [
  { id: 'radius-0', name: 'Sharp', value: '0' },
  { id: 'radius-sm', name: 'Small', value: '0.3rem' },
  { id: 'radius-default', name: 'Default', value: '0.625rem' },
  { id: 'radius-lg', name: 'Large', value: '1rem' },
];

const PAGE_STYLES: { id: PageStyleVariant; name: string }[] = [
  { id: 'card', name: 'Card Wrapper' },
  { id: 'fused', name: 'Fused (Edge to edge)' },
];

const LAYOUTS: { id: LayoutVariant; name: string }[] = [
  { id: 'sidebar', name: 'Sidebar Navigation' },
  { id: 'topnav', name: 'Top Navigation' },
];

export function AppearanceSection() {
  const {
    theme,
    setTheme,
    background,
    setBackground,
    panelBg,
    setPanelBg,
    navBg,
    setNavBg,
    radius,
    setRadius,
    pageStyle,
    setPageStyle,
    layout,
    setLayout,
    isMounted,
  } = useThemeCustomizer();

  if (!isMounted) return null;

  return (
    <div className="space-y-10 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Appearance</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the look and feel of your workspace.
        </p>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold border-b pb-2">Theme & Colors</h3>
        <div className="space-y-6">
          <div className="space-y-2.5">
            <label className="text-xs font-medium text-muted-foreground">
              Primary Accent Color
            </label>
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={cn(
                    'relative flex flex-col items-center justify-center gap-2 rounded-lg border p-2 text-xs transition-all hover:bg-muted/50',
                    theme === t.id ? 'border-border bg-white' : 'border-muted/20',
                  )}
                >
                  <div
                    className="h-6 w-6 rounded-full  ring-1 ring-border/20"
                    style={{ background: t.color }}
                  />
                  {theme === t.id && (
                    <Check className="absolute top-1 right-1 size-3 text-primary" />
                  )}
                  <span className="truncate w-full text-center text-[10px] text-muted-foreground">
                    {t.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold border-b pb-2">Layout Preferences</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2.5">
            <label className="text-xs font-medium text-muted-foreground">Navigation Style</label>
            <div className="flex flex-col gap-2">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLayout(l.id)}
                  className={cn(
                    'rounded-lg border p-2.5 text-xs font-medium transition-all text-left',
                    layout === l.id
                      ? 'border-border bg-white text-foreground'
                      : 'border-muted/20 text-foreground hover:bg-muted/30',
                  )}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <label className="text-xs font-medium text-muted-foreground">App Wrapper</label>
            <div className="flex flex-col gap-2">
              {PAGE_STYLES.map((ps) => (
                <button
                  key={ps.id}
                  onClick={() => setPageStyle(ps.id)}
                  className={cn(
                    'rounded-lg border p-2.5 text-xs font-medium transition-all text-left',
                    pageStyle === ps.id
                      ? 'border-border bg-white text-foreground'
                      : 'border-muted/20 text-foreground hover:bg-muted/30',
                  )}
                >
                  {ps.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold border-b pb-2">Backgrounds & Shapes</h3>
        <TooltipProvider delay={200}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="space-y-2.5">
              <label className="text-xs font-medium text-muted-foreground">Page Base</label>
              <div className="flex flex-wrap gap-2">
                {BACKGROUNDS.map((bg) => (
                  <Tooltip key={bg.id}>
                    <TooltipTrigger
                      render={
                        <button
                          onClick={() => setBackground(bg.id)}
                          className={cn(
                            'flex items-center justify-center rounded-full border p-0.5 transition-all hover:scale-110',
                            background === bg.id ? 'border-primary' : 'border-transparent',
                          )}
                        />
                      }
                    >
                      <div
                        className={cn(
                          'h-5 w-5 rounded-full ring-1 ring-border/20  shrink-0',
                          bg.id === 'bg-default' && 'border-dashed border-2',
                        )}
                        style={{ background: bg.color }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-[10px]">
                      {bg.name}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              <label className="text-xs font-medium text-muted-foreground">Content Panel</label>
              <div className="flex flex-wrap gap-2">
                {PANEL_BACKGROUNDS.map((pb) => (
                  <Tooltip key={pb.id}>
                    <TooltipTrigger
                      render={
                        <button
                          onClick={() => setPanelBg(pb.id)}
                          className={cn(
                            'flex items-center justify-center rounded-full border p-0.5 transition-all hover:scale-110',
                            panelBg === pb.id ? 'border-primary' : 'border-transparent',
                          )}
                        />
                      }
                    >
                      <div
                        className={cn(
                          'h-5 w-5 rounded-full ring-1 ring-border/20  shrink-0',
                          pb.id === 'panel-default' && 'border-dashed border-2',
                        )}
                        style={{ background: pb.color }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-[10px]">
                      {pb.name}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              <label className="text-xs font-medium text-muted-foreground">Sidebar Nav</label>
              <div className="flex flex-wrap gap-2">
                {PANEL_BACKGROUNDS.map((pb) => (
                  <Tooltip key={`nav-${pb.id}`}>
                    <TooltipTrigger
                      render={
                        <button
                          onClick={() => setNavBg(pb.id)}
                          className={cn(
                            'flex items-center justify-center rounded-full border p-0.5 transition-all hover:scale-110',
                            navBg === pb.id ? 'border-primary' : 'border-transparent',
                          )}
                        />
                      }
                    >
                      <div
                        className={cn(
                          'h-5 w-5 rounded-full ring-1 ring-border/20  shrink-0',
                          pb.id === 'panel-default' && 'border-dashed border-2',
                        )}
                        style={{ background: pb.color }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-[10px]">
                      {pb.name}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          </div>
        </TooltipProvider>

        <div className="space-y-2.5 pt-4">
          <label className="text-xs font-medium text-muted-foreground">Corners Radius</label>
          <div className="flex flex-wrap gap-2">
            {RADIUSES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRadius(r.id)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-all',
                  radius === r.id
                    ? 'border-border bg-white text-foreground'
                    : 'border-muted/20 text-foreground hover:bg-muted/30',
                )}
                style={{ borderRadius: r.value }}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
