'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { Database, FolderOpen } from 'lucide-react';
import { WorkspaceLineTabs, WorkspacePageHeading } from '@larkup/workspace-ui';
import type { DataGroup } from '@larkup/core/types';
import { DataWorkspace } from './data-workspace';
import { GroupsPanel } from './groups-panel';

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
        <WorkspacePageHeading
          title="Data"
          description="Add sources, organize groups, and manage indexing."
        />
        <WorkspaceLineTabs
          className="mt-6"
          items={[
            { id: 'all', label: 'All Data', icon: Database },
            { id: 'groups', label: 'Groups', icon: FolderOpen },
          ]}
          activeId={activeView}
          onChange={setActiveView}
        />
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
