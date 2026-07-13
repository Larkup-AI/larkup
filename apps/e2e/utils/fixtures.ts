import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DATA_DIR = path.resolve(__dirname, "../demo-data");

export const FIXTURES = {
  pdf: path.join(DEMO_DATA_DIR, "demo.pdf"),
  txt: path.join(DEMO_DATA_DIR, "demo.txt"),
  docx: path.join(DEMO_DATA_DIR, "demo.docx"),
  json: path.join(DEMO_DATA_DIR, "demo.json"),
  csv: path.join(DEMO_DATA_DIR, "demo.csv"),
} as const;

/**
 * Read a fixture file as a Buffer.
 */
export function readFixture(name: keyof typeof FIXTURES): Buffer {
  const filePath = FIXTURES[name];
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath);
}

/**
 * Get the filename for a fixture (e.g. "demo.pdf").
 */
export function fixtureName(name: keyof typeof FIXTURES): string {
  return path.basename(FIXTURES[name]);
}

/**
 * Check if a fixture exists.
 */
export function fixtureExists(name: keyof typeof FIXTURES): boolean {
  return fs.existsSync(FIXTURES[name]);
}

// Test constants
export const TEST_QUERY = "What is Larkup?";
export const TEST_PASTE_TEXT = `Larkup is an open-source toolkit designed to launch a production-ready RAG server from local to deployment in minutes. It eliminates the complexities of manual infrastructure setup, allowing you to seamlessly configure vector stores, chunking strategies, and embedding models through a unified interface.`;
export const TEST_PASTE_TITLE = "E2E Test Document — Pasted Text";
export const TEST_SCRAPE_URL = "https://example.com";
