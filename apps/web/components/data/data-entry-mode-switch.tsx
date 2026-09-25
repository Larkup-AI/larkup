'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DataEntryModeOption {
  value: string;
  label: string;
  icon: LucideIcon;
}

export function DataEntryModeSwitch({
  value,
  onValueChange,
  options,
  label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly DataEntryModeOption[];
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-10 w-fit items-center gap-1 rounded-lg border border-border/90 bg-muted/60 p-1 text-muted-foreground"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            data-state={active ? 'active' : 'inactive'}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              active
                ? 'bg-background text-foreground ring-1 ring-border'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" strokeWidth={active ? 2 : 1.75} aria-hidden="true" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
