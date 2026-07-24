import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");
const cliBin = path.join(repoRoot, "apps/cli/dist/index.js");
let workspace: string;

function cli(args: string[], cwd = workspace): string {
  return execFileSync(process.execPath, [cliBin, ...args], {
    cwd,
    timeout: 60_000,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test" },
  });
}

test.describe.configure({ mode: "serial" });

test.describe("Larkup CLI", () => {
  test.beforeAll(() => {
    execFileSync("pnpm", ["--filter", "@larkup/cli", "build"], {
      cwd: repoRoot,
      timeout: 120_000,
      stdio: "inherit",
    });
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "larkup-cli-e2e-"));
    fs.mkdirSync(path.join(workspace, "knowledge"));
    fs.writeFileSync(path.join(workspace, "knowledge", "one.md"), "# One\nFirst document.");
    fs.writeFileSync(path.join(workspace, "knowledge", "two.txt"), "Second document.");
  });

  test.afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test("--help exposes the application commands", () => {
    const output = cli(["--help"], repoRoot);
    for (const command of [
      "index",
      "documents",
      "serve",
      "chat",
      "marketplace",
      "deploy",
      "test",
      "update",
      "open",
    ]) {
      expect(output).toContain(command);
    }
  });

  test("initializes and loads a folder without indexing", () => {
    expect(cli(["init", "CLI E2E"])).toContain("Created server");
    expect(cli(["index", "./knowledge", "--no-run"])).toContain("Loaded 2 documents");

    const config = cli(["config"]);
    expect(config).toContain("CLI E2E");
    expect(config).toContain("corpus");
    expect(config).toContain("2 docs");
  });

  test("validates the active configuration", () => {
    const documents = cli(["documents"]);
    expect(documents).toContain("one.md");
    expect(documents).toContain("two.txt");

    const exportPath = path.join(workspace, "corpus.jsonl");
    expect(
      cli(["documents", "export", "--format", "jsonl", "--out", exportPath]),
    ).toContain("Exported corpus");
    expect(fs.readFileSync(exportPath, "utf8").trim().split("\n")).toHaveLength(2);

    const output = cli(["test"]);
    expect(output).toContain("Configuration is valid");
    expect(output).toContain("2 document");
  });

  test("generates a deployable server with chat", () => {
    const outputDir = path.join(workspace, "deployment");
    expect(cli(["deploy", "export", "--out", outputDir])).toContain(
      "Deployment artifact ready",
    );
    expect(fs.existsSync(path.join(outputDir, "server.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "chat.mjs"))).toBe(true);
    expect(fs.readFileSync(path.join(outputDir, "server.mjs"), "utf8")).toContain(
      'pathname === "/chat"',
    );
    execFileSync(process.execPath, ["--check", path.join(outputDir, "server.mjs")]);
    execFileSync(process.execPath, ["--check", path.join(outputDir, "chat.mjs")]);
  });
});
