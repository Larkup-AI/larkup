'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { GlobalSettings } from './global-settings';

import {
  useThemeCustomizer,
  ThemeVariant,
  BackgroundVariant,
  PanelBgVariant,
  LayoutVariant,
  RadiusVariant,
  PageStyleVariant,
} from './theme-customizer-provider';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import {
  SlidersHorizontal,
  LayoutTemplate,
  Palette,
  Monitor,
  SquareDashed,
  PanelTop,
  User,
  Check,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from './ui/input';

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

const PANEL_BACKGROUNDS: {
  id: PanelBgVariant;
  name: string;
  color: string;
}[] = [
  { id: 'panel-default', name: 'Theme Default', color: '#FAFAFA' },
  { id: 'panel-white', name: 'White', color: '#FFFFFF' },
  { id: 'panel-fafafa', name: 'Near White', color: '#F4F4F4' },
  { id: 'panel-silver', name: 'Silver', color: '#F8F8F8' },
  { id: 'panel-soft', name: 'Soft', color: '#FBFAF8' },
  { id: 'panel-stone', name: 'Stone', color: '#F5F5F2' },
  { id: 'panel-warm', name: 'Warm Cream', color: '#F7F1EA' },
];

const LAYOUTS: { id: LayoutVariant; name: string }[] = [
  { id: 'sidebar', name: 'Sidebar (Left)' },
  { id: 'topnav', name: 'Top Navigation' },
];

const RADIUSES: { id: RadiusVariant; name: string; value: string }[] = [
  { id: 'radius-0', name: 'Sharp (0)', value: '0' },
  { id: 'radius-sm', name: 'Small', value: '0.3rem' },
  { id: 'radius-default', name: 'Default', value: '0.625rem' },
  { id: 'radius-lg', name: 'Large', value: '1rem' },
];

const PAGE_STYLES: { id: PageStyleVariant; name: string }[] = [
  { id: 'card', name: 'Card (Rounded/Shadow)' },
  { id: 'fused', name: 'Fused (Flat)' },
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
  const {
    theme,
    setTheme,
    background,
    setBackground,
    panelBg,
    setPanelBg,
    navBg,
    setNavBg,
    layout,
    setLayout,
    radius,
    setRadius,
    pageStyle,
    setPageStyle,
    isMounted,
  } = useThemeCustomizer();

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
                      {/* <Check className="h-3.5 w-3.5 " /> */}
                    </Button>
                  </div>
                </div>

                {/* Color Theme */}
                <div className="space-y-3">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Palette className="h-4 w-4 text-muted-foreground" /> Color Palette
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {THEMES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTheme(t.id)}
                        className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 p-2 text-xs transition-all hover:bg-muted ${
                          theme === t.id ? 'border-primary bg-primary/5' : 'border-transparent'
                        }`}
                      >
                        <div
                          className="h-6 w-6 rounded-full border "
                          style={{ background: t.color }}
                        />
                        <span className="truncate w-full text-center">{t.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Page Background */}
                <TooltipProvider delay={200}>
                  <div className="space-y-3">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <SquareDashed className="h-4 w-4 text-muted-foreground" /> Page Background
                    </label>
                    <p className="text-[11px] text-muted-foreground -mt-1">
                      Full page background behind everything
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {BACKGROUNDS.map((bg) => (
                        <Tooltip key={bg.id}>
                          <TooltipTrigger
                            render={
                              <button
                                onClick={() => setBackground(bg.id)}
                                className={`flex items-center justify-center rounded-full border-2 p-0.5 transition-all hover:scale-110 ${
                                  background === bg.id ? 'border-primary' : 'border-transparent'
                                }`}
                              />
                            }
                          >
                            <div
                              className={`h-6 w-6 rounded-full border shrink-0 ${
                                bg.id === 'bg-default' ? 'border-dashed' : ''
                              }`}
                              style={{ background: bg.color }}
                            />
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={6}>
                            <span className="text-xs font-medium">{bg.name}</span>
                            <span className="text-[10px] text-muted-foreground ml-1.5">
                              {bg.color}
                            </span>
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                </TooltipProvider>

                {/* Panel / Content Background */}
                <TooltipProvider delay={200}>
                  <div className="space-y-3">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <PanelTop className="h-4 w-4 text-muted-foreground" /> Content Panel
                      Background
                    </label>
                    <p className="text-[11px] text-muted-foreground -mt-1">
                      Inner content area (card / main panel)
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {PANEL_BACKGROUNDS.map((pb) => (
                        <Tooltip key={pb.id}>
                          <TooltipTrigger
                            render={
                              <button
                                onClick={() => setPanelBg(pb.id)}
                                className={`flex items-center justify-center rounded-full border-2 p-0.5 transition-all hover:scale-110 ${
                                  panelBg === pb.id ? 'border-primary' : 'border-transparent'
                                }`}
                              />
                            }
                          >
                            <div
                              className={`h-6 w-6 rounded-full border shrink-0 ${
                                pb.id === 'panel-default' ? 'border-dashed' : ''
                              }`}
                              style={{ background: pb.color }}
                            />
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={6}>
                            <span className="text-xs font-medium">{pb.name}</span>
                            <span className="text-[10px] text-muted-foreground ml-1.5">
                              {pb.color}
                            </span>
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                </TooltipProvider>

                {/* Nav/Sidebar Background */}
                <TooltipProvider delay={200}>
                  <div className="space-y-3">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <LayoutTemplate className="h-4 w-4 text-muted-foreground" /> Sidebar / Topnav
                      Background
                    </label>
                    <p className="text-[11px] text-muted-foreground -mt-1">
                      Background color for the side or top navigation
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {PANEL_BACKGROUNDS.map((pb) => (
                        <Tooltip key={`nav-${pb.id}`}>
                          <TooltipTrigger
                            render={
                              <button
                                onClick={() => setNavBg(pb.id)}
                                className={`flex items-center justify-center rounded-full border-2 p-0.5 transition-all hover:scale-110 ${
                                  navBg === pb.id ? 'border-primary' : 'border-transparent'
                                }`}
                              />
                            }
                          >
                            <div
                              className={`h-6 w-6 rounded-full border shrink-0 ${
                                pb.id === 'panel-default' ? 'border-dashed' : ''
                              }`}
                              style={{ background: pb.color }}
                            />
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={6}>
                            <span className="text-xs font-medium">{pb.name}</span>
                            <span className="text-[10px] text-muted-foreground ml-1.5">
                              {pb.color}
                            </span>
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                </TooltipProvider>

                {/* Layout */}
                <div className="space-y-3">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <LayoutTemplate className="h-4 w-4 text-muted-foreground" /> Layout Style
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {LAYOUTS.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => setLayout(l.id)}
                        className={`rounded-md border-2 p-2 text-sm transition-all hover:bg-muted ${
                          layout === l.id ? 'border-primary bg-primary/5' : 'border-border'
                        }`}
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Page Style */}
                <div className="space-y-3">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <SquareDashed className="h-4 w-4 text-muted-foreground" /> Page Style
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {PAGE_STYLES.map((ps) => (
                      <button
                        key={ps.id}
                        onClick={() => setPageStyle(ps.id)}
                        className={`rounded-md border-2 p-2 text-xs transition-all hover:bg-muted ${
                          pageStyle === ps.id ? 'border-primary bg-primary/5' : 'border-border'
                        }`}
                      >
                        {ps.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Border Radius */}
                <div className="space-y-3">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-muted-foreground" /> Border Radius
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {RADIUSES.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setRadius(r.id)}
                        className={`rounded-md border-2 px-3 py-1 text-xs transition-all hover:bg-muted ${
                          radius === r.id ? 'border-primary bg-primary/5' : 'border-border'
                        }`}
                        style={{ borderRadius: r.value }}
                      >
                        {r.name}
                      </button>
                    ))}
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
