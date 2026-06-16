"use client";

import {
  useThemeCustomizer,
  ThemeVariant,
  BackgroundVariant,
  LayoutVariant,
  RadiusVariant,
  PageStyleVariant,
} from "./theme-customizer-provider";
import {
  SlidersHorizontal,
  LayoutTemplate,
  Palette,
  Monitor,
  SquareDashed,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const THEMES: { id: ThemeVariant; name: string; color: string }[] = [
  { id: "default", name: "Caffee", color: "#f2efe4" },
  { id: "theme-gaia", name: "Emerald Green", color: "#2b935f" },
  { id: "theme-docker", name: "Ocean Blue", color: "#1d63ed" },
  { id: "theme-pinecone", name: "Deep Indigo", color: "#6e56cf" },
  { id: "theme-vercel", name: "Minimal Black", color: "#000000" },
  { id: "theme-elevenlabs", name: "Soft Cream", color: "#f8f7f5" },
  { id: "theme-espresso", name: "Espresso", color: "#6B3F2A" },
  { id: "theme-sienna", name: "Warm Sienna", color: "#A0522D" },
  { id: "theme-caramel", name: "Caramel", color: "#C47C3E" },
];

const BACKGROUNDS: { id: BackgroundVariant; name: string; color: string }[] = [
  { id: "bg-default", name: "Theme Default", color: "transparent" },
  { id: "bg-warm", name: "Warm Cream", color: "#F7F1EA" },
  { id: "bg-soft", name: "Soft White", color: "#FBFAF8" },
  { id: "bg-pure", name: "Pure White", color: "#FFFFFF" },
];

const LAYOUTS: { id: LayoutVariant; name: string }[] = [
  { id: "sidebar", name: "Sidebar (Left)" },
  { id: "topnav", name: "Top Navigation" },
];

const RADIUSES: { id: RadiusVariant; name: string; value: string }[] = [
  { id: "radius-0", name: "Sharp (0)", value: "0" },
  { id: "radius-sm", name: "Small", value: "0.3rem" },
  { id: "radius-default", name: "Default", value: "0.625rem" },
  { id: "radius-lg", name: "Large", value: "1rem" },
];

const PAGE_STYLES: { id: PageStyleVariant; name: string }[] = [
  { id: "card", name: "Card (Rounded/Shadow)" },
  { id: "fused", name: "Fused (Flat)" },
];

export function ThemeSwitcher({ floating = true }: { floating?: boolean }) {
  const {
    theme,
    setTheme,
    background,
    setBackground,
    layout,
    setLayout,
    radius,
    setRadius,
    pageStyle,
    setPageStyle,
    isMounted,
  } = useThemeCustomizer();

  if (!isMounted) return null;

  const wrapperClass = floating
    ? "fixed bottom-6 right-6 z-50"
    : "flex items-center";
  const buttonClass = floating
    ? "h-12 w-12 rounded-full shadow-xl"
    : "size-9 rounded-lg border border-border bg-card text-primary shadow-sm hover:bg-accent hover:text-accent-foreground";

  return (
    <div className={wrapperClass}>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant={floating ? "default" : "ghost"}
              size="icon"
              className={buttonClass}
            >
              <SlidersHorizontal className={floating ? "h-5 w-5" : "h-4 w-4"} />
            </Button>
          }
        />
        <PopoverContent align="end" className="w-80 p-0 shadow-2xl flex flex-col max-h-[85vh]">
          <div className="border-b px-4 py-3 font-semibold flex items-center gap-2 shrink-0">
            <Palette className="h-4 w-4" /> Theme Customizer
          </div>
          <div className="p-4 space-y-6 overflow-y-auto">
            {/* Color Theme */}
            <div className="space-y-3">
              <label className="text-sm font-medium flex items-center gap-2">
                <Palette className="h-4 w-4 text-muted-foreground" /> Color
                Palette
              </label>
              <div className="grid grid-cols-3 gap-2">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 p-2 text-xs transition-all hover:bg-muted ${
                      theme === t.id
                        ? "border-primary bg-primary/5"
                        : "border-transparent"
                    }`}
                  >
                    <div
                      className="h-6 w-6 rounded-full border shadow-sm"
                      style={{ background: t.color }}
                    />
                    <span className="truncate w-full text-center">
                      {t.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Background Style */}
            <div className="space-y-3">
              <label className="text-sm font-medium flex items-center gap-2">
                <SquareDashed className="h-4 w-4 text-muted-foreground" /> Background
                Style
              </label>
              <div className="flex flex-wrap gap-2">
                {BACKGROUNDS.map((bg) => (
                  <button
                    key={bg.id}
                    onClick={() => setBackground(bg.id)}
                    title={bg.name}
                    className={`flex items-center justify-center rounded-full border-2 p-0.5 transition-all hover:scale-110 ${
                      background === bg.id
                        ? "border-primary"
                        : "border-transparent"
                    }`}
                  >
                    <div
                      className={`h-6 w-6 rounded-full border flex-shrink-0 ${bg.id === "bg-default" ? "border-dashed" : "shadow-sm"}`}
                      style={{ background: bg.color }}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Layout */}
            <div className="space-y-3">
              <label className="text-sm font-medium flex items-center gap-2">
                <LayoutTemplate className="h-4 w-4 text-muted-foreground" />{" "}
                Layout Style
              </label>
              <div className="grid grid-cols-2 gap-2">
                {LAYOUTS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLayout(l.id)}
                    className={`rounded-md border-2 p-2 text-sm transition-all hover:bg-muted ${
                      layout === l.id
                        ? "border-primary bg-primary/5"
                        : "border-border"
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
                <SquareDashed className="h-4 w-4 text-muted-foreground" /> Page
                Style
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PAGE_STYLES.map((ps) => (
                  <button
                    key={ps.id}
                    onClick={() => setPageStyle(ps.id)}
                    className={`rounded-md border-2 p-2 text-xs transition-all hover:bg-muted ${
                      pageStyle === ps.id
                        ? "border-primary bg-primary/5"
                        : "border-border"
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
                <Monitor className="h-4 w-4 text-muted-foreground" /> Border
                Radius
              </label>
              <div className="flex flex-wrap gap-2">
                {RADIUSES.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRadius(r.id)}
                    className={`rounded-md border-2 px-3 py-1 text-xs transition-all hover:bg-muted ${
                      radius === r.id
                        ? "border-primary bg-primary/5"
                        : "border-border"
                    }`}
                    style={{ borderRadius: r.value }}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
