import { Suspense } from 'react';
import { AgentCustomizationSection } from '@/components/settings/general/agent-customization-section';

export default function AgentPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-6 lg:p-8">
          <Suspense fallback={null}>
            <AgentCustomizationSection />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
