'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { SettingsLayout, type SettingsSection } from '@/components/settings/settings-layout';
import { GeneralSection } from '@/components/settings/general/general-section';
import { ModelsSection } from '@/components/settings/general/models-section';
import { RunDeployAgentSection } from '@/components/settings/runtime/runtime-section';
import { AgentCustomizationSection } from '@/components/settings/general/agent-customization-section';
import { SearchIntegrationsSection } from '@/components/settings/general/search-scraping-section';
import { StorageSection } from '@/components/settings/general/storage-indexing-section';
import { MarketplaceSection } from '@/components/settings/hub/marketplace-section';
import { MarketplaceToolsSettings } from '@/components/settings/hub/marketplace-tools-settings';
import { AnalyticsDashboard } from '@/components/analytics/analytics-dashboard';
import { CalendarClock } from 'lucide-react';

const SETTINGS_SECTIONS: SettingsSection[] = [
  'general',
  'models',
  'storage',
  'search-web',
  'agent-customization',
  'runtime',
  'monitoring',
  'automations',
  'marketplace',
  'tool-settings',
];

function SettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const resolveSection = (): SettingsSection | null => {
    if (searchParams.has('ai-models')) return 'models';
    const section = searchParams.get('section');
    if (section && SETTINGS_SECTIONS.includes(section as SettingsSection)) {
      return section as SettingsSection;
    }
    if (section) return null;
    return 'general';
  };

  const [activeSection, setActiveSection] = useState<SettingsSection | null>(resolveSection);

  useEffect(() => {
    setActiveSection(resolveSection());
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.has('ai-models')) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('ai-models');
      params.set('section', 'models');
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, [searchParams, pathname, router]);

  const handleSectionChange = (newSection: SettingsSection) => {
    setActiveSection(newSection);
    const nextUrl = `${pathname}?section=${newSection}`;
    window.history.replaceState(null, '', nextUrl);
    router.replace(nextUrl, { scroll: false });
  };

  return (
    <SettingsLayout
      activeSection={activeSection}
      onSectionChange={handleSectionChange}
      fullWidth={false}
    >
      {activeSection === 'general' && <GeneralSection />}
      {activeSection === 'models' && <ModelsSection />}
      {activeSection === 'storage' && <StorageSection />}
      {activeSection === 'agent-customization' && <AgentCustomizationSection />}
      {activeSection === 'runtime' && <RunDeployAgentSection />}
      {activeSection === 'marketplace' && <MarketplaceSection />}
      {activeSection === 'tool-settings' && <MarketplaceToolsSettings />}
      {activeSection === 'search-web' && <SearchIntegrationsSection />}
      {activeSection === 'monitoring' && (
        <section className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Monitoring</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Track this Project’s health, latency, errors, and usage by local or remote deployment.
            </p>
          </div>
          <AnalyticsDashboard />
        </section>
      )}
      {activeSection === 'automations' && (
        <section className="space-y-2">
          <h1 className="text-xl font-semibold">Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Source sync and incremental re-index jobs run while the local Project Runtime is on.
          </p>
          <div className="rounded-lg flex flex-col items-center justify-center h-32 p-6 text-sm text-muted-foreground">
            <CalendarClock className="size-6 mb-2" />
            <p>Cron tasks are coming soon.</p>
          </div>
        </section>
      )}
      {activeSection === null && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h2 className="text-lg font-semibold">Section not found</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The settings section you are looking for does not exist or has been removed.
          </p>
        </div>
      )}
    </SettingsLayout>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
