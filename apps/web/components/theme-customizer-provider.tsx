'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeVariant = 'default' | 'theme-larkup' | 'theme-gaia';

export type LayoutVariant = 'sidebar' | 'topnav' | 'collapsed';

interface ThemeCustomizerContextValue {
  theme: ThemeVariant;
  setTheme: (theme: ThemeVariant) => void;
  layout: LayoutVariant;
  setLayout: (layout: LayoutVariant) => void;
  isMounted: boolean;
}

const ThemeCustomizerContext = createContext<ThemeCustomizerContextValue | null>(null);

export function useThemeCustomizer() {
  const ctx = useContext(ThemeCustomizerContext);
  if (!ctx) {
    throw new Error('useThemeCustomizer must be used within a ThemeCustomizerProvider');
  }
  return ctx;
}

export function ThemeCustomizerProvider({ children }: { children: React.ReactNode }) {
  const [isMounted, setIsMounted] = useState(false);
  const [theme, setThemeState] = useState<ThemeVariant>('default');
  const [layout, setLayout] = useState<LayoutVariant>('sidebar');

  useEffect(() => {
    setIsMounted(true);

    const savedTheme = localStorage.getItem('app-theme') as ThemeVariant;
    const savedLayout = localStorage.getItem('app-layout') as LayoutVariant;

    if (savedTheme && (savedTheme === 'default' || savedTheme === 'theme-larkup')) {
      setThemeState(savedTheme);
    }
    if (savedLayout) setLayout(savedLayout);

    // Clean up old localStorage keys from the previous theme system
    localStorage.removeItem('app-background');
    localStorage.removeItem('app-panel-bg');
    localStorage.removeItem('app-nav-bg');
    localStorage.removeItem('app-radius');
    localStorage.removeItem('app-pagestyle');
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    localStorage.setItem('app-theme', theme);
    localStorage.setItem('app-layout', layout);

    // Update body classes
    const body = document.body;

    // Remove old theme classes
    Array.from(body.classList).forEach((cls) => {
      if (cls.startsWith('theme-')) {
        body.classList.remove(cls);
      }
    });

    // Remove old bg-* and radius-* classes from previous theme system
    Array.from(body.classList).forEach((cls) => {
      if (cls.startsWith('bg-') || cls.startsWith('radius-')) {
        body.classList.remove(cls);
      }
    });

    // Add new theme class
    if (theme !== 'default') body.classList.add(theme);
  }, [theme, layout, isMounted]);

  return (
    <ThemeCustomizerContext.Provider
      value={{
        theme,
        setTheme: setThemeState,
        layout,
        setLayout,
        isMounted,
      }}
    >
      {children}
    </ThemeCustomizerContext.Provider>
  );
}
