import React from 'react';
import { cn } from '@/lib/utils';

export interface LineTab {
  id: string;
  label: string;
  icon?: React.ElementType;
}

export interface LineTabsProps {
  tabs: readonly LineTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  rightElement?: React.ReactNode;
  className?: string;
}

export function LineTabs({
  tabs,
  activeTab,
  onTabChange,
  rightElement,
  className,
}: LineTabsProps) {
  return (
    <div className={cn("flex items-center justify-between border-b border-border", className)}>
      <div className="-mb-px flex items-center gap-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors outline-none',
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {Icon && <Icon className="size-4" />}
              {tab.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 motion-safe:duration-200"
                />
              )}
            </button>
          );
        })}
      </div>
      {rightElement && (
        <div className="flex items-center gap-2">
          {rightElement}
        </div>
      )}
    </div>
  );
}
