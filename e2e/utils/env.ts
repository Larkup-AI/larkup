export function getWebUIUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4567';
}

export function rewriteLocalUrl(localUrl: string): string {
  if (!process.env.PLAYWRIGHT_BASE_URL) return localUrl;

  try {
    const webUrl = new URL(process.env.PLAYWRIGHT_BASE_URL);
    const targetUrl = new URL(localUrl);
    if (webUrl.hostname !== 'localhost') {
      targetUrl.hostname = webUrl.hostname;
    }
    return targetUrl.toString().replace(/\/$/, '');
  } catch {
    return localUrl;
  }
}
