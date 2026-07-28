'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { SettingsLayout, type SettingsSection } from '@/components/settings/settings-layout';
import { GeneralSection } from '@/components/settings/general-section';
import { ModelsSection } from '@/components/settings/models-section';
import { ServerSection } from '@/components/settings/server-section';
import { PromptsSection } from '@/components/settings/prompts-section';
import { PlaygroundSection } from '@/components/settings/playground-section';
import { AppearanceSection } from '@/components/settings/appearance-section';
import { StorageSection } from '@/components/settings/storage-section';
import { ConnectionsSection } from '@/components/settings/connections-section';
import { DeploymentSection } from '@/components/settings/deployment-section';
import { MarketplaceSection } from '@/components/settings/marketplace-section';
import { MarketplaceToolsSettings } from '@/components/settings/marketplace-tools-settings';

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

  // Keep an immediate local selection as well as the URL. A slow Installed
  // Tools request must never make the rest of the settings navigation feel
  // frozen while Next finishes a route transition.
  const [activeSection, setActiveSection] = useState<SettingsSection>(resolveSection);

  useEffect(() => {
    setActiveSection(resolveSection());
  }, [searchParams]);

  useEffect(() => {
    // Normalize legacy `?ai-models` param to `?section=models`
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
    // Keep Next's route state in sync in the background. The local state above
    // is intentionally updated first so this remains responsive if a section
    // has a slow request in flight.
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
      {activeSection === 'prompts' && <PromptsSection />}
      {activeSection === 'playground' && <PlaygroundSection />}
      {activeSection === 'appearance' && <AppearanceSection />}
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
