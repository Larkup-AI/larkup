// Pure, dependency-free classification of which uploaded file types the server
// can read from storage and parse during background ingestion. These are
// uploaded to S3 and ingested as one durable knowledge source each (parsed,
// chunked, embedded and indexed by the worker) instead of being parsed in the
// browser or split into parts. Extracted so it can be unit-tested without
// loading the client upload panel.

// xlsx/xls/doc are intentionally excluded: the server cannot parse them, so they
// keep the in-browser path.
export const SERVER_PARSEABLE_EXT = /\.(pdf|docx|txt|md|markdown|toml|json|html?|log|xml|csv)$/;

export function isServerParseable(name: string): boolean {
  return SERVER_PARSEABLE_EXT.test(name.toLowerCase());
}
