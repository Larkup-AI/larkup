export function formatCacheBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) {
    const kilobytes = bytes / 1024;
    return kilobytes < 0.05 ? '< 0.1 KB' : `${kilobytes.toFixed(1)} KB`;
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
