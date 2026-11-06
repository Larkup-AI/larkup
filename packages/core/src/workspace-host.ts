import type { UsageEvent } from './analytics-store';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DataGroup, MediaAsset, RagConfig, SourceDocument } from './types';
import type { ProjectMeta } from './project-store';
import type { TabularDataset, TabularDatasetMeta } from './tabular-store';

/** Request-scoped persistence; Cloud supplies tenant-bound repositories. */
export interface WorkspaceHost {
  project: ProjectMeta;
  readState(key: string): Promise<unknown>;
  writeState(key: string, value: unknown): Promise<void>;
  trackUsage(event: Omit<UsageEvent, 'id'>): Promise<UsageEvent>;
  readConfig(): Promise<RagConfig>;
  writeConfig(config: RagConfig): Promise<RagConfig>;
  readDocuments(): Promise<SourceDocument[]>;
  writeDocuments(documents: SourceDocument[]): Promise<void>;
  readGroups(): Promise<DataGroup[]>;
  writeGroups(groups: DataGroup[]): Promise<void>;
  readMediaAssets(): Promise<MediaAsset[]>;
  writeMediaAssets(assets: MediaAsset[]): Promise<void>;
  readTabularDatasets(): Promise<TabularDataset[]>;
  writeTabularDatasets(datasets: TabularDataset[]): Promise<void>;
  /** Optional bounded persistence operations for hosts that keep large rows outside metadata storage. */
  listTabularDatasets?(): Promise<TabularDatasetMeta[]>;
  getTabularDataset?(id: string): Promise<TabularDataset | null>;
  saveTabularDataset?(dataset: TabularDataset): Promise<void>;
  deleteTabularDataset?(id: string): Promise<void>;
  clearTabularDatasets?(): Promise<void>;
  updateTabularDatasetsGroup?(ids: string[], groupId: string): Promise<TabularDatasetMeta[]>;
  queryKnowledge(
    query: string,
    topK: number,
  ): Promise<
    Array<{
      id: string;
      documentId: string;
      title: string;
      text: string;
      score: number;
      url?: string;
      metadata?: Record<string, unknown>;
    }>
  >;
  /** Canonical Marketplace modules supplied by a managed host without a mutable local install. */
  tools?: Array<{
    id: string;
    version: string;
    installedAt: string;
    packageName: string;
    resolvedPath: string;
    source: 'registry' | 'local' | 'sandbox';
    config: Record<string, unknown>;
    module: Record<string, unknown>;
  }>;
}
const scope = new AsyncLocalStorage<WorkspaceHost>();
export function workspaceHost(): WorkspaceHost | undefined {
  return scope.getStore();
}
export function runWithWorkspaceHost<T>(host: WorkspaceHost, operation: () => T): T {
  return scope.run(host, operation);
}
