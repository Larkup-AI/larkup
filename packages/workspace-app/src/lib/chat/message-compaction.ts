export function compactToolResult(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (value.type === 'json' && 'value' in value) {
    return { ...value, value: compactToolResult(value.value) };
  }

  const compact = { ...value };
  if (Array.isArray(compact.rows)) compact.rows = compact.rows.slice(0, 50);
  if (Array.isArray(compact.data)) compact.data = compact.data.slice(0, 100);
  if (typeof compact.stdout === 'string') compact.stdout = compact.stdout.slice(0, 4_000);
  if (typeof compact.stderr === 'string') compact.stderr = compact.stderr.slice(0, 1_000);
  if (typeof compact.fileBase64 === 'string') delete compact.fileBase64;
  if (Array.isArray(compact.pages)) {
    compact.pages = compact.pages.slice(0, 3).flatMap((page: any) => {
      if (!page || typeof page !== 'object' || !Number.isInteger(page.pageNumber)) return [];
      return [
        {
          pageNumber: page.pageNumber,
          ...(typeof page.previewUrl === 'string' ? { previewUrl: page.previewUrl } : {}),
        },
      ];
    });
  }
  return compact;
}
