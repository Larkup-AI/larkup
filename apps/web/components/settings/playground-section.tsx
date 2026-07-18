"use client";

import { DemoWorkspace } from "@/components/demo/demo-workspace";

export function PlaygroundSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Playground</h2>
        <p className="text-sm text-muted-foreground">
          Test your search and retrieval to see what your AI returns.
        </p>
      </div>
      <DemoWorkspace />
    </div>
  );
}
