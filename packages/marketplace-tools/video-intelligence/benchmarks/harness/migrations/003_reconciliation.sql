CREATE TABLE usage_reconciliations(usage_id TEXT PRIMARY KEY REFERENCES usage_events(id), actual TEXT NOT NULL, provenance TEXT NOT NULL, recorded_at TEXT NOT NULL);
