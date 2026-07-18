"use client";

import { useState } from "react";

export function VisualizationTabs({
  tabs,
}: {
  tabs: { label: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(0);

  if (tabs.length === 1) return <>{tabs[0].content}</>;

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-2 border-b border-border/40 pb-0 px-1">
        {tabs.map((tab, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(i)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              active === i
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="animate-in fade-in slide-in-from-bottom-1 duration-500">
        {tabs[active]?.content}
      </div>
    </div>
  );
}
