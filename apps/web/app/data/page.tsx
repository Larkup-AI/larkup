import { Suspense } from 'react';
import { DataWorkspace } from '@/components/data/data-workspace';

export default function DataPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-2 md:px-8">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Knowledge Base</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review and manage everything your AI can learn from.
        </p>
      </div>
      <div className="flex-1 min-h-0 pb-8">
        <Suspense>
          <DataWorkspace view="corpus" />
        </Suspense>
      </div>
    </div>
  );
}
