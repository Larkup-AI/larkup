'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { SettingsLayout, type SettingsSection } from '@/components/settings/settings-layout';
import { GeneralSection } from '@/components/settings/general-section';
import { ModelsSection } from '@/components/settings/models-section';
import { ServerSection } from '@/components/settings/server-section';
import { PromptsSection } from '@/components/settings/prompts-section';
import { PlaygroundSection } from '@/components/settings/playground-section';
import { SearchIntegrationsSection } from '@/components/settings/search-integrations-section';
import { StorageSection } from '@/components/settings/storage-section';
import { ConnectionsSection } from '@/components/settings/connections-section';
import { DeploymentSection } from '@/components/settings/deployment-section';
import { MarketplaceSection } from '@/components/settings/marketplace-section';
import { MarketplaceToolsSettings } from '@/components/settings/marketplace-tools-settings';
import { AgentSection } from '@/components/settings/agent-section';
import { AnalyticsDashboard } from '@/components/analytics/analytics-dashboard';

function SettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const resolveSection = (): SettingsSection => {
    if (searchParams.has('ai-models')) return 'models';
    const section = searchParams.get('section') as SettingsSection;
    if (section) return section;
    return 'general';
  };

  const [activeSection, setActiveSection] = useState<SettingsSection>(resolveSection);

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
    <SettingsLayout activeSection={activeSection} onSectionChange={handleSectionChange}>
      {activeSection === 'general' && <GeneralSection />}
      {activeSection === 'models' && <ModelsSection />}
      {activeSection === 'storage' && <StorageSection />}
      {activeSection === 'server' && <ServerSection />}
      {activeSection === 'connections' && <ConnectionsSection />}
      {activeSection === 'deployment' && <DeploymentSection />}
      {activeSection === 'marketplace' && <MarketplaceSection />}
      {activeSection === 'tool-settings' && <MarketplaceToolsSettings />}
      {activeSection === 'agents' && <AgentSection />}
      {activeSection === 'prompts' && <PromptsSection />}
      {activeSection === 'playground' && <PlaygroundSection />}
      {activeSection === 'search-web' && <SearchIntegrationsSection />}
      {activeSection === 'analytics' && (
        <section className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Analytics</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Track usage, requests, and performance of your AI server.
            </p>
          </div>
          <AnalyticsDashboard />
        </section>
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
