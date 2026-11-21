import icons from '../integration-icon-data.json';

/** Use bundled thumbnails; retain the supplied URL for host-defined integrations. */
export function integrationIconSource(path: string): string {
  return Object.prototype.hasOwnProperty.call(icons, path)
    ? (icons as Record<string, string>)[path]
    : path;
}
