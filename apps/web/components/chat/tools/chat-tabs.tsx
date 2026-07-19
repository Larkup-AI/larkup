"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface ChatTabItem {
  label: string;
  icon?: React.ReactNode;
  content: React.ReactNode;
}

export interface ChatTabsConfig {
  tabs: ChatTabItem[];
  defaultIndex?: number;
}

/**
 * Premium tabbed interface for chat tool responses.
 * Supports optional icons per tab with a smooth animated underline.
 */
export function ChatTabs({ config }: { config: ChatTabsConfig }) {
  const { tabs, defaultIndex = 0 } = config;
  const [active, setActive] = useState(defaultIndex);

  if (!tabs || tabs.length === 0) return null;
  if (tabs.length === 1) return <>{tabs[0].content}</>;

  return (
    <div className="w-full my-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 border-b border-border/30 px-1">
        {tabs.map((tab, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(i)}
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors",
              "focus:outline-none focus-visible:outline-none",
              active === i
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/70",
            )}
          >
            {tab.icon && (
              <span className="shrink-0 [&_svg]:size-3.5">{tab.icon}</span>
            )}
            <span>{tab.label}</span>
            {/* Animated underline */}
            {active === i && (
              <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-foreground animate-in fade-in zoom-in-75 duration-300" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div
        key={active}
        className="pt-3 animate-in fade-in slide-in-from-bottom-1 duration-400"
      >
        {tabs[active]?.content}
      </div>
    </div>
  );
}
