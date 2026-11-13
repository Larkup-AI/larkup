import { Suspense } from 'react';
import { AnalyticsDashboard } from '@/components/analytics/analytics-dashboard';

export default function MonitorPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Monitoring</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Track this Project&rsquo;s health, latency, errors, and usage by local or remote
              deployment.
            </p>
          </div>
          <Suspense fallback={null}>
            <AnalyticsDashboard />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
