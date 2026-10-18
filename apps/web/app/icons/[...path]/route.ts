import { workspaceAssetResponse } from '@larkup/workspace-app/asset-server';
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return workspaceAssetResponse('icons/' + (await params).path.join('/'));
}
