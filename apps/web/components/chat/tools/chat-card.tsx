"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatCardConfig {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * A collapsible content card for chat responses.
 * Inspired by the "Risk Mitigation & Governance" section style from the screenshot.
 */
export function ChatCard({ config }: { config: ChatCardConfig }) {
  const {
    title,
    subtitle,
    icon,
    collapsible = true,
    defaultOpen = true,
    children,
  } = config;

  const [open, setOpen] = useState(defaultOpen);

  const headerContent = (
    <div className="flex items-center gap-2.5 min-w-0">
      {icon && (
        <span className="shrink-0 text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground truncate">
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border/40 bg-card/30 my-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/10 focus:outline-none focus-visible:outline-none"
        >
          {headerContent}
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">
          {headerContent}
        </div>
      )}

      {/* Content */}
      {open && (
        <div className="border-t border-border/30 animate-in fade-in slide-in-from-top-1 duration-300">
          {children}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Simplified functional API — no config wrapper needed                 */
/* ------------------------------------------------------------------ */

export function ChatCardSimple({
  title,
  subtitle,
  icon,
  collapsible = true,
  defaultOpen = true,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <ChatCard
      config={{
        title,
        subtitle,
        icon,
        collapsible,
        defaultOpen,
        children,
      }}
    />
  );
}
