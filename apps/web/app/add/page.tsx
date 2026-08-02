import { Suspense } from 'react';
import { DataWorkspace } from '@/components/data/data-workspace';

export default function AddPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-0 pb-8 pt-6">
        <Suspense>
          <DataWorkspace view="add" />
        </Suspense>
      </div>
    </div>
  );
}
