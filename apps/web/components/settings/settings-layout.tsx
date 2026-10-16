'use client';

import {
  Settings2,
  CpuIcon,
  Database,
  Store,
  Globe,
  Terminal,
  Activity,
  Blocks,
  Wrench,
} from 'lucide-react';
import { WorkspaceSettingsLayout, type WorkspaceSettingsGroup } from '@larkup/workspace-ui';

export type SettingsSection =
  | 'general'
  | 'models'
  | 'storage'
  | 'search-web'
  | 'agent-customization'
  | 'runtime'
  | 'monitoring'
  | 'automations'
  | 'marketplace'
  | 'tool-settings';

const SECTION_GROUPS: WorkspaceSettingsGroup<SettingsSection>[] = [
  {
    label: 'Project',
    items: [
      { id: 'general', label: 'General', icon: Settings2 },
      { id: 'models', label: 'AI Models', icon: CpuIcon },
      { id: 'storage', label: 'Storage & indexing', icon: Database },
      { id: 'search-web', label: 'Search & Scraping', icon: Globe },
    ],
  },
  {
    label: 'Hub',
    items: [
      { id: 'marketplace', label: 'Marketplace', icon: Store },
      { id: 'tool-settings', label: 'Installed Tools', icon: Wrench },
    ],
  },
  {
    label: 'Runtime',
    items: [
      { id: 'agent-customization', label: 'Agent Customization', icon: Blocks },
      { id: 'runtime', label: 'Larkup Server', icon: Terminal },
      { id: 'monitoring', label: 'Monitor', icon: Activity },
      // { id: 'automations', label: 'Jobs', icon: Clock3 }, // TODO:: Later
    ],
  },
];

interface SettingsLayoutProps {
  children: React.ReactNode;
  activeSection: SettingsSection | null;
  onSectionChange: (section: SettingsSection) => void;
  fullWidth?: boolean;
}

export function SettingsLayout({
  children,
  activeSection,
  onSectionChange,
  fullWidth = false,
}: SettingsLayoutProps) {
  return (
    <WorkspaceSettingsLayout
      groups={SECTION_GROUPS}
      activeId={activeSection}
      onSelect={onSectionChange}
      fullWidth={fullWidth}
    >
      {children}
    </WorkspaceSettingsLayout>
  );
}
