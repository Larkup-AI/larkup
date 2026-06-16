"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeVariant =
  | "default"
  | "theme-gaia"
  | "theme-docker"
  | "theme-pinecone"
  | "theme-vercel"
  | "theme-elevenlabs"
  | "theme-espresso"
  | "theme-sienna"
  | "theme-caramel";

export type BackgroundVariant = "bg-default" | "bg-warm" | "bg-soft" | "bg-pure";

export type LayoutVariant = "sidebar" | "topnav" | "collapsed";

export type RadiusVariant =
  | "radius-0"
  | "radius-sm"
  | "radius-default"
  | "radius-lg";

export type PageStyleVariant = "card" | "fused";


interface ThemeCustomizerContextValue {
  theme: ThemeVariant;
  setTheme: (theme: ThemeVariant) => void;
  layout: LayoutVariant;
  setLayout: (layout: LayoutVariant) => void;
  radius: RadiusVariant;
  setRadius: (radius: RadiusVariant) => void;
  background: BackgroundVariant;
  setBackground: (bg: BackgroundVariant) => void;
  pageStyle: PageStyleVariant;
  setPageStyle: (style: PageStyleVariant) => void;
  isMounted: boolean;
}

const ThemeCustomizerContext = createContext<ThemeCustomizerContextValue | null>(
  null,
);

export function useThemeCustomizer() {
  const ctx = useContext(ThemeCustomizerContext);
  if (!ctx) {
    throw new Error(
      "useThemeCustomizer must be used within a ThemeCustomizerProvider",
    );
  }
  return ctx;
}

export function ThemeCustomizerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isMounted, setIsMounted] = useState(false);
  const [theme, setTheme] = useState<ThemeVariant>("theme-caramel");
  const [layout, setLayout] = useState<LayoutVariant>("topnav");
  const [radius, setRadius] = useState<RadiusVariant>("radius-default");
  const [background, setBackground] = useState<BackgroundVariant>("bg-soft");
  const [pageStyle, setPageStyle] = useState<PageStyleVariant>("card");

  useEffect(() => {
    setIsMounted(true);
    const savedTheme = localStorage.getItem("app-theme") as ThemeVariant;
    const savedLayout = localStorage.getItem("app-layout") as LayoutVariant;
    const savedRadius = localStorage.getItem("app-radius") as RadiusVariant;
    const savedBackground = localStorage.getItem("app-background") as BackgroundVariant;
    const savedPageStyle = localStorage.getItem("app-pagestyle") as PageStyleVariant;

    if (savedTheme) setTheme(savedTheme);
    if (savedLayout) setLayout(savedLayout);
    if (savedRadius) setRadius(savedRadius);
    if (savedBackground) setBackground(savedBackground);
    if (savedPageStyle) setPageStyle(savedPageStyle);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    localStorage.setItem("app-theme", theme);
    localStorage.setItem("app-layout", layout);
    localStorage.setItem("app-radius", radius);
    localStorage.setItem("app-background", background);
    localStorage.setItem("app-pagestyle", pageStyle);

    // Update body classes
    const body = document.body;
    
    // Remove old classes
    body.classList.forEach((cls) => {
      if (cls.startsWith("theme-") || cls.startsWith("radius-") || cls.startsWith("bg-")) {
        body.classList.remove(cls);
      }
    });

    // Add new classes
    if (theme !== "default") body.classList.add(theme);
    if (radius !== "radius-default") body.classList.add(radius);
    if (background !== "bg-default") body.classList.add(background);
  }, [theme, layout, radius, background, pageStyle, isMounted]);

  return (
    <ThemeCustomizerContext.Provider
      value={{
        theme,
        setTheme,
        layout,
        setLayout,
        radius,
        setRadius,
        background,
        setBackground,
        pageStyle,
        setPageStyle,
        isMounted,
      }}
    >
      {children}
    </ThemeCustomizerContext.Provider>
  );
}
