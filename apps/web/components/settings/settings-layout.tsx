'use client';

import {
  Settings2,
  CpuIcon,
  Server,
  Search,
  Database,
  Plug,
  Store,
  Bot,
  type LucideIcon,
  Grid2X2Plus,
  BarChart3,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type SettingsSection =
  | 'general'
  | 'models'
  | 'storage'
  | 'search-web'
  | 'connections'
  | 'server'
  | 'prompts'
  | 'playground'
  | 'deployment'
  | 'marketplace'
  | 'tool-settings'
  | 'agents'
  | 'analytics';

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
    label: 'Larkup Settings',
    items: [
      { id: 'general', label: 'General', icon: Settings2 },
      { id: 'models', label: 'AI Models', icon: CpuIcon },
      { id: 'storage', label: 'Storage', icon: Database },
      { id: 'search-web', label: 'Search & Scraping', icon: Globe },
      { id: 'connections', label: 'Connections', icon: Plug },
    ],
  },
  {
    label: 'Hub',
    items: [
      { id: 'marketplace', label: 'Marketplace', icon: Store },
      { id: 'tool-settings', label: 'Installed Tools', icon: Plug },
      { id: 'agents', label: 'Agents', icon: Bot },
    ],
  },
  {
    label: 'Advanced',
    items: [
      { id: 'server', label: 'Larkup Server', icon: Server },
      { id: 'prompts', label: 'Agent Customization', icon: Grid2X2Plus },
      { id: 'playground', label: 'Playground', icon: Search },
      { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
];

interface SettingsLayoutProps {
  children: React.ReactNode;
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

export function SettingsLayout({ children, activeSection, onSectionChange }: SettingsLayoutProps) {
  return (
    <div className="flex h-full min-h-[500px]">
      <aside className="w-[240px] shrink-0 border-r bg-muted/20">
        <nav className="flex h-full flex-col gap-6 p-4">
          {SECTION_GROUPS.map((group) => (
            <div key={group.label}>
              <h4 className="mb-2 px-2 text-xs font-semibold tracking-wider text-muted-foreground/70 uppercase">
                {group.label}
              </h4>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onSectionChange(item.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                      activeSection === item.id
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
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
        <div className="mx-auto max-w-4xl p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
