'use client';

import { useState, useEffect, Suspense } from 'react';
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

function SettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const getInitialSection = (): SettingsSection => {
    if (searchParams.has('ai-models')) return 'models';
    const section = searchParams.get('section') as SettingsSection;
    if (section) return section;
    return 'general';
  };

  const [activeSection, setActiveSection] = useState<SettingsSection>(getInitialSection());

  useEffect(() => {
    const currentSection = searchParams.get('section');
    const hasAiModels = searchParams.has('ai-models');

    if (hasAiModels) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('ai-models');
      params.set('section', 'models');
      router.replace(`${pathname}?${params.toString()}`);
      if (activeSection !== 'models') {
        setActiveSection('models');
      }
    } else if (currentSection && currentSection !== activeSection) {
      setActiveSection(currentSection as SettingsSection);
    }
  }, [searchParams, activeSection, pathname, router]);

  const handleSectionChange = (newSection: SettingsSection) => {
    setActiveSection(newSection);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('ai-models');
    params.set('section', newSection);
    router.replace(`${pathname}?${params.toString()}`);
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
