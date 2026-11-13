import { Suspense } from 'react';
import { RunDeployAgentSection } from '@/components/settings/runtime/runtime-section';

export default function DeployPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full p-6 lg:px-10 lg:py-8">
          <Suspense fallback={null}>
            <RunDeployAgentSection />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
