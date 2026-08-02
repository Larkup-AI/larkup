import { Check } from 'lucide-react';

/** The crawler starts automatically when the user searches or adds a website. */
export function FirecrawlNotice() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Check className="size-3.5 text-emerald-600" />
      Built-in crawler ready
    </span>
  );
}
