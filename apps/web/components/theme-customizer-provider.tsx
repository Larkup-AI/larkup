"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeVariant =
  | "default"
  | "theme-gaia"
  | "theme-docker"
  | "theme-pinecone"
  | "theme-vercel"
  | "theme-elevenlabs";

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
  const [theme, setTheme] = useState<ThemeVariant>("default");
  const [layout, setLayout] = useState<LayoutVariant>("sidebar");
  const [radius, setRadius] = useState<RadiusVariant>("radius-default");
  const [pageStyle, setPageStyle] = useState<PageStyleVariant>("card");

  useEffect(() => {
    setIsMounted(true);
    const savedTheme = localStorage.getItem("app-theme") as ThemeVariant;
    const savedLayout = localStorage.getItem("app-layout") as LayoutVariant;
    const savedRadius = localStorage.getItem("app-radius") as RadiusVariant;
    const savedPageStyle = localStorage.getItem("app-pagestyle") as PageStyleVariant;

    if (savedTheme) setTheme(savedTheme);
    if (savedLayout) setLayout(savedLayout);
    if (savedRadius) setRadius(savedRadius);
    if (savedPageStyle) setPageStyle(savedPageStyle);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    localStorage.setItem("app-theme", theme);
    localStorage.setItem("app-layout", layout);
    localStorage.setItem("app-radius", radius);
    localStorage.setItem("app-pagestyle", pageStyle);

    // Update body classes
    const body = document.body;
    
    // Remove old classes
    body.classList.forEach((cls) => {
      if (cls.startsWith("theme-") || cls.startsWith("radius-")) {
        body.classList.remove(cls);
      }
    });

    // Add new classes
    if (theme !== "default") body.classList.add(theme);
    if (radius !== "radius-default") body.classList.add(radius);
  }, [theme, layout, radius, pageStyle, isMounted]);

  return (
    <ThemeCustomizerContext.Provider
      value={{
        theme,
        setTheme,
        layout,
        setLayout,
        radius,
        setRadius,
        pageStyle,
        setPageStyle,
        isMounted,
      }}
    >
      {children}
    </ThemeCustomizerContext.Provider>
  );
}
