import { workspaceAssetResponse } from '@larkup/workspace-app/asset-server';
export function GET() {
  return workspaceAssetResponse('notion.png');
}
