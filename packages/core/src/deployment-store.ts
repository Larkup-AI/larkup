import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_DEPLOYMENT_CONFIG, type AgentDeploymentConfig } from './types';
import { getDataDir, requireDataDir } from './workspace';

/**
 * File-backed persistence for a server's deployment configuration.
 */

export async function readDeploymentConfig(): Promise<AgentDeploymentConfig> {
  const dir = await getDataDir();
  if (!dir) return DEFAULT_DEPLOYMENT_CONFIG;
  try {
    const raw = await fs.readFile(path.join(dir, 'deployment.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AgentDeploymentConfig>;

    return {
      ...DEFAULT_DEPLOYMENT_CONFIG,
      ...parsed,
      widgetStyle: {
        ...DEFAULT_DEPLOYMENT_CONFIG.widgetStyle,
        ...parsed.widgetStyle,
      },
    };
  } catch {
    return DEFAULT_DEPLOYMENT_CONFIG;
  }
}

export async function writeDeploymentConfig(
  config: AgentDeploymentConfig,
): Promise<AgentDeploymentConfig> {
  const dir = await requireDataDir();
  await fs.writeFile(path.join(dir, 'deployment.json'), JSON.stringify(config, null, 2), 'utf8');
  return config;
}
