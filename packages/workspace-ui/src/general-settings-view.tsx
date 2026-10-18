'use client';
import type { ReactNode, ElementType } from 'react';
import { Loader2, Save, PanelLeft, PanelTop } from 'lucide-react';
import { Button } from './button.js';
import { Input } from './input.js';
import { Label } from './label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from './card.js';
import type { ThemeVariant, LayoutVariant } from './theme-customizer-provider.js';
const THEMES: { id: ThemeVariant; name: string; color: string; description: string }[] = [
  {
    id: 'theme-gaia',
    name: 'Warm Ivory',
    color: '#e6d343ff',
    description: 'Warm ivory with dark accents',
  },
  {
    id: 'default',
    name: 'Minimalist Gray',
    color: '#636262ff',
    description: 'Clean & minimal gray palette',
  },
  {
    id: 'theme-linear',
    name: 'Crisp White',
    color: '#c7c6c6ff',
    description: 'Crisp white with soft gray navigation',
  },
];

const LAYOUTS: {
  id: LayoutVariant;
  name: string;
  description: string;
  icon: ElementType;
  color: string;
}[] = [
  {
    id: 'sidebar',
    name: 'Sidebar Navigation',
    description: 'Classic left sidebar layout',
    icon: PanelLeft,
    color: 'text-blue-500',
  },
  {
    id: 'topnav',
    name: 'Top Navigation',
    description: 'Horizontal navigation bar',
    icon: PanelTop,
    color: 'text-emerald-500',
  },
];

export interface GeneralSettingsViewProps {
  localName: string;
  setLocalName: (name: string) => void;
  saving: string | null;
  dirtyUsername: boolean;
  handleSave: (section: 'username') => void;
  theme: ThemeVariant;
  setTheme: (theme: ThemeVariant, persist?: boolean) => void;
  layout: LayoutVariant;
  setLayout: (layout: LayoutVariant, persist?: boolean) => void;
  isMounted: boolean;
  dirtyAppearance: boolean;
  handleSaveAppearance: () => void;
  cache?: ReactNode;
}
export function GeneralSettingsView({
  localName,
  setLocalName,
  saving,
  dirtyUsername,
  handleSave,
  theme,
  setTheme,
  layout,
  setLayout,
  isMounted,
  dirtyAppearance,
  handleSaveAppearance,
  cache,
}: GeneralSettingsViewProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">General</h2>
          <p className="text-sm text-muted-foreground">Project settings and preferences.</p>
        </div>
      </div>

      {/* Username */}
      <Card id="web-crawler" className="">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Your Name</CardTitle>
          <CardDescription className="text-xs">Displayed in the workspace header.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder="Enter your name"
            className=""
          />
        </CardContent>
        <CardFooter className="flex justify-end pt-4 border-t">
          <Button
            size="lg"
            disabled={saving === 'username' || !dirtyUsername}
            onClick={() => handleSave('username')}
            className="gap-1.5 px-4"
          >
            {saving === 'username' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </CardFooter>
      </Card>

      {/* Appearance */}
      {isMounted && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Appearance</CardTitle>
            <CardDescription className="text-xs">
              Customize the theme and layout of your workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label className="text-xs">Theme</Label>
              <Select value={theme} onValueChange={(val) => setTheme(val as ThemeVariant, false)}>
                <SelectTrigger className="w-full text-sm">
                  {THEMES.find((t) => t.id === theme) ? (
                    <div className="flex items-center gap-2 flex-1 text-left">
                      <div
                        className="h-3 w-3 rounded-full border border-border/50"
                        style={{ background: THEMES.find((t) => t.id === theme)?.color }}
                      />
                      <span>{THEMES.find((t) => t.id === theme)?.name}</span>
                    </div>
                  ) : (
                    <SelectValue placeholder="Select theme" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  {THEMES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full border border-border/50"
                          style={{ background: t.color }}
                        />
                        <span>{t.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label className="text-xs">Navigation Style</Label>
              <Select
                value={layout}
                onValueChange={(val) => setLayout(val as LayoutVariant, false)}
              >
                <SelectTrigger className="w-full text-sm">
                  {LAYOUTS.find((l) => l.id === layout) ? (
                    <div className="flex items-center gap-2 flex-1 text-left">
                      {(() => {
                        const l = LAYOUTS.find((l) => l.id === layout)!;
                        const Icon = l.icon;
                        return (
                          <>
                            <Icon className={`size-4 ${l.color}`} />
                            <span>{l.name}</span>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <SelectValue placeholder="Select layout" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  {LAYOUTS.map((l) => {
                    const Icon = l.icon;
                    return (
                      <SelectItem key={l.id} value={l.id}>
                        <div className="flex items-center gap-2">
                          <Icon className={`size-4 ${l.color}`} />
                          <span>{l.name}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end pt-4 border-t">
            <Button
              size="lg"
              disabled={!dirtyAppearance}
              onClick={handleSaveAppearance}
              className="gap-1.5 px-4"
            >
              <Save className="size-3.5" />
              Save
            </Button>
          </CardFooter>
        </Card>
      )}

      {cache}
    </div>
  );
}
