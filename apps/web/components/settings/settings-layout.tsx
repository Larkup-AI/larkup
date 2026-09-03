'use client';

import {
  Settings2,
  CpuIcon,
  Database,
  Plug,
  Store,
  Bot,
  type LucideIcon,
  Globe,
  Terminal,
  Activity,
  Clock3,
  Blocks,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface SectionItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}

interface SectionGroup {
  label: string;
  items: SectionItem[];
}

const SECTION_GROUPS: SectionGroup[] = [
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
    <div className="flex h-full min-h-125">
      <aside className="w-60 shrink-0 border-r bg-muted/40">
        <nav className="flex h-full flex-col gap-7 p-4">
          {SECTION_GROUPS.map((group) => (
            <div key={group.label}>
              <h4 className="mb-2 px-3 text-[12px] font-semibold text-muted-foreground">
                {group.label}
              </h4>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onSectionChange(item.id)}
                    className={cn(
                      'flex w-full items-center  gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors',
                      activeSection === item.id
                        ? 'bg-sidebar-accent/50 dark:bg-white/10 text-foreground font-medium'
                        : 'font-normal text-muted-foreground/90 hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div
          className={cn(fullWidth ? 'w-full p-6 lg:px-10 lg:py-8' : 'mx-auto max-w-6xl p-6 lg:p-8')}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
