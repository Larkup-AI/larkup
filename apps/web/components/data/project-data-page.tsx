'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { Database, FolderOpen } from 'lucide-react';
import type { DataGroup } from '@larkup/core/types';
import { DataWorkspace } from './data-workspace';
import { GroupsPanel } from './groups-panel';
import { cn } from '@/lib/utils';

const fetcher = (url: string) => fetch(url).then((response) => response.json());

/** Simple, tab-first source management for the active Project. */
export function ProjectDataPage() {
  const router = useRouter();
  const [activeView, setActiveView] = useState<'all' | 'groups'>('all');
  const { data } = useSWR<{ groups: DataGroup[] }>('/api/groups', fetcher);
  const groups = data?.groups ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="pt-6 px-6 md:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Data</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add sources, organize groups, and manage indexing.
          </p>
        </div>

        <div className="flex items-center gap-1 mt-6 border-b border-border w-full overflow-x-auto scrollbar-none">
          {(['all', 'groups'] as const).map((tab) => {
            const isActive = activeView === tab;
            const label = tab === 'all' ? 'All Data' : 'Groups';
            const Icon = tab === 'all' ? Database : FolderOpen;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveView(tab)}
                className={cn(
                  'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors outline-none whitespace-nowrap',
                  isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 motion-safe:duration-200"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 mt-4">
        {activeView === 'all' ? (
          <DataWorkspace view="corpus" />
        ) : (
          <GroupsPanel
            onAddToGroup={(groupId) => router.push(`/add?groupId=${encodeURIComponent(groupId)}`)}
            onView={(groupId) => {
              router.replace(`/data?groupId=${groupId}`);
              setActiveView('all');
            }}
          />
        )}
      </div>
    </div>
  );
}
