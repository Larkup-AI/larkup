import assetData from './asset-data.json';
/** Generated from the canonical assets at package build time; no host filesystem paths. */
export function workspaceAssetResponse(path: string): Response {
  const bytes = Object.prototype.hasOwnProperty.call(assetData, path)
    ? (assetData as Record<string, string>)[path]
    : undefined;
  if (!bytes) return new Response('Not found', { status: 404 });
  const extension = path.split('.').at(-1)!;
  return new Response(Buffer.from(bytes, 'base64'), {
    headers: {
      'content-type':
        extension === 'svg'
          ? 'image/svg+xml'
          : 'image/' + (extension === 'jpg' ? 'jpeg' : extension),
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
