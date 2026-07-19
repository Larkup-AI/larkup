import { AnalyticsDashboard } from '@/components/analytics/analytics-dashboard';

export default function AnalyticsPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 pt-6 pb-2 md:px-8 mx-auto max-w-7xl w-full">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track usage, requests, and performance of your AI server.
        </p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-6 md:p-8 mx-auto max-w-7xl w-full">
          <AnalyticsDashboard />
        </div>
      </div>
    </div>
  );
}
