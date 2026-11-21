/** Resolve catalog paths consistently across host filesystem case rules. */
export function integrationIconBytes(assets, icon) {
  const normalized = icon.replace(/^\//, '').toLowerCase();
  const matches = Object.keys(assets).filter((path) => path.toLowerCase() === normalized);
  if (matches.length !== 1) {
    throw new Error(`Integration icon must match exactly one bundled asset: ${icon}`);
  }
  return Buffer.from(assets[matches[0]], 'base64');
}
