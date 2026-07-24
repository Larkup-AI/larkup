import { promises as fs } from "node:fs";
import path from "node:path";

export interface LocalTextFile {
  path: string;
  title: string;
  content: string;
}

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".mdx",
  ".json",
  ".jsonl",
  ".csv",
  ".tsv",
  ".html",
  ".htm",
  ".xml",
  ".yaml",
  ".yml",
  ".log",
  ".rst",
  ".tex",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".sql",
  ".sh",
  ".css",
]);

const MEDIA_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".mp3",
  ".m4a",
  ".wav",
  ".ogg",
  ".flac",
]);

const SKIPPED_DIRECTORIES = new Set([".git", ".larkup", "node_modules", "dist", "build"]);

export function isMediaPath(filePath: string) {
  return MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function collectFiles(inputs: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const input of inputs) {
    const absolute = path.resolve(input);
    const stat = await fs.stat(absolute).catch(() => undefined);
    if (!stat) throw new Error(`Path does not exist: ${input}`);

    if (stat.isFile()) {
      files.push(absolute);
      continue;
    }

    if (!stat.isDirectory()) continue;
    await walk(absolute, files);
  }

  return files.sort();
}

async function walk(directory: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
      await walk(path.join(directory, entry.name), files);
    } else if (entry.isFile()) {
      files.push(path.join(directory, entry.name));
    }
  }
}

export async function readTextFiles(files: string[]): Promise<LocalTextFile[]> {
  const documents: LocalTextFile[] = [];
  for (const filePath of files) {
    if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) continue;
    const content = await fs.readFile(filePath, "utf8");
    if (!content.trim() || content.includes("\0")) continue;
    documents.push({
      path: filePath,
      title: path.basename(filePath),
      content,
    });
  }
  return documents;
}
