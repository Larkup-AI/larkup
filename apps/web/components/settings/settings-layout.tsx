'use client';

import {
  Settings2,
  Sparkles,
  Server,
  MessageSquareText,
  Search,
  Palette,
  Database,
  Plug,
  Store,
  Share2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type SettingsSection =
  | 'general'
  | 'models'
  | 'storage'
  | 'server'
  | 'connections'
  | 'prompts'
  | 'playground'
  | 'appearance'
  | 'deployment'
  | 'marketplace';

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
    label: 'Larkup Settiings',
    items: [
      { id: 'general', label: 'General', icon: Settings2 },
      { id: 'models', label: 'AI Models', icon: Sparkles },
      { id: 'storage', label: 'Storage', icon: Database },
      { id: 'server', label: 'Larkup Server', icon: Server },
      { id: 'connections', label: 'Connections', icon: Plug },
      // { id: 'deployment', label: 'Deploy & Share', icon: Share2 },
    ],
  },
  {
    label: 'Hub',
    items: [{ id: 'marketplace', label: 'Marketplace', icon: Store }],
  },
  {
    label: 'Advanced',
    items: [
      { id: 'prompts', label: 'Agent Customization', icon: MessageSquareText },
      { id: 'playground', label: 'Playground', icon: Search },
      { id: 'appearance', label: 'Appearance', icon: Palette },
    ],
  },
];

interface SettingsLayoutProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  children: React.ReactNode;
}

export function SettingsLayout({ activeSection, onSectionChange, children }: SettingsLayoutProps) {
  // Find the label for breadcrumbs
  const activeLabel =
    SECTION_GROUPS.flatMap((g) => g.items).find((i) => i.id === activeSection)?.label || 'Settings';

  return (
    <div className="flex h-full w-full flex-1 min-h-0 bg-transparent">
      <nav className="hidden md:flex w-[240px] shrink-0 flex-col overflow-y-auto h-full bg-transparent border-r border-border/40">
        <div className="flex flex-col gap-6 py-6 px-4">
          {SECTION_GROUPS.map((group) => (
            <div key={group.label}>
              <h3 className="px-3 mb-2 text-[11px] font-semibold text-muted-foreground">
                {group.label}
              </h3>
              <div className="flex flex-col gap-0.5">
                {group.items.map((section) => {
                  const Icon = section.icon;
                  const active = activeSection === section.id;

                  return (
                    <button
                      key={section.id}
                      onClick={() => onSectionChange(section.id)}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-all duration-200 text-left outline-none',
                        active
                          ? 'font-medium text-foreground bg-[#F0F0F0]'
                          : 'font-normal text-muted-foreground hover:bg-[#EBEBEB] hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4 shrink-0" strokeWidth={active ? 2.25 : 1.75} />
                      <span className="truncate">{section.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="flex md:hidden w-full px-4 py-3 gap-2 overflow-x-auto shrink-0 border-b border-border/40 bg-background">
        {SECTION_GROUPS.flatMap((g) => g.items).map((section) => {
          const Icon = section.icon;
          const active = activeSection === section.id;

          return (
            <button
              key={section.id}
              onClick={() => onSectionChange(section.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors border',
                active
                  ? 'bg-[#F0F0F0] border-transparent text-foreground'
                  : 'bg-transparent border-transparent text-muted-foreground hover:bg-[#EBEBEB]',
              )}
            >
              <Icon className="size-3.5" />
              {section.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-w-0 h-full overflow-y-auto bg-transparent">
        <div className="mx-auto max-w-5xl px-8 py-8 md:px-12 md:py-10">{children}</div>
      </div>
    </div>
  );
}
