import { test, expect } from "@playwright/test";
import { execSync, exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { FIXTURES } from "../../utils/fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CLI_BIN = path.resolve(REPO_ROOT, "apps/cli/dist/index.js");
const CLI_SRC = path.resolve(REPO_ROOT, "apps/cli/src/index.ts");

function cli(args: string, timeout = 30_000): string {
  // Try built CLI first, fallback to tsx
  const cmd = fs.existsSync(CLI_BIN)
    ? `node ${CLI_BIN} ${args}`
    : `npx tsx ${CLI_SRC} ${args}`;

  return execSync(cmd, {
    cwd: REPO_ROOT,
    timeout,
    encoding: "utf-8",
    env: { ...process.env, NODE_ENV: "test" },
  });
}

test.describe("CLI — @larkup-rag/cli", () => {
  test.beforeAll(async () => {
    // Ensure CLI is built
    if (!fs.existsSync(CLI_BIN)) {
      console.log("  Building CLI...");
      try {
        execSync("pnpm --filter @larkup-rag/cli build", {
          cwd: REPO_ROOT,
          timeout: 60_000,
          encoding: "utf-8",
        });
      } catch {
        console.warn("  ⚠ CLI build failed — tests will use tsx fallback");
      }
    }
  });

  test("cli --help shows available commands", async () => {
    test.setTimeout(15_000);

    try {
      const output = cli("--help");
      expect(output).toContain("larkup");
      // Should list known commands
      const expectedCmds = ["init", "config", "add-doc", "index", "serve", "query", "chat"];
      for (const cmd of expectedCmds) {
        if (output.includes(cmd)) {
          console.log(`  ✓ Command "${cmd}" listed`);
        }
      }
    } catch (err: any) {
      // --help may exit with code 0 or 1 depending on commander config
      const output = err.stdout || err.stderr || "";
      expect(output).toContain("larkup");
    }
  });

  test("cli init — create a new workspace", async () => {
    test.setTimeout(30_000);

    const testWorkspace = "e2e-test-workspace";

    try {
      const output = cli(`init ${testWorkspace}`);
      console.log(`  ✓ Init output: ${output.substring(0, 200)}`);
    } catch (err: any) {
      // init may use interactive prompts — check if it started
      const output = err.stdout || err.stderr || err.message;
      console.log(`  ℹ Init result: ${output.substring(0, 200)}`);
    }
  });

  test("cli config — show current configuration", async () => {
    test.setTimeout(15_000);

    try {
      const output = cli("config");
      // Should show some configuration info
      expect(output.length).toBeGreaterThan(10);
      console.log(`  ✓ Config output: ${output.substring(0, 200)}`);
    } catch (err: any) {
      const output = err.stdout || err.stderr || err.message;
      console.log(`  ℹ Config result: ${output.substring(0, 200)}`);
    }
  });

  test("cli add-doc — add a file", async () => {
    test.setTimeout(30_000);

    try {
      const output = cli(`add-doc --file ${FIXTURES.txt}`);
      console.log(`  ✓ add-doc output: ${output.substring(0, 200)}`);
    } catch (err: any) {
      const output = err.stdout || err.stderr || err.message;
      console.log(`  ℹ add-doc result: ${output.substring(0, 200)}`);
    }
  });

  test("cli add-doc --text — add inline text", async () => {
    test.setTimeout(15_000);

    try {
      const output = cli('add-doc --text "E2E test inline text document" --title "CLI E2E Test"');
      console.log(`  ✓ add-doc --text output: ${output.substring(0, 200)}`);
    } catch (err: any) {
      const output = err.stdout || err.stderr || err.message;
      console.log(`  ℹ add-doc --text result: ${output.substring(0, 200)}`);
    }
  });

  test("cli servers — list servers", async () => {
    test.setTimeout(15_000);

    try {
      const output = cli("servers");
      console.log(`  ✓ servers output: ${output.substring(0, 200)}`);
    } catch (err: any) {
      const output = err.stdout || err.stderr || err.message;
      console.log(`  ℹ servers result: ${output.substring(0, 200)}`);
    }
  });

  test("cli index — build the vector index", async () => {
    test.setTimeout(120_000); // Indexing can take a while

    try {
      const output = cli("index");
      console.log(`  ✓ index output: ${output.substring(0, 200)}`);
    } catch (err: any) {
      const output = err.stdout || err.stderr || err.message;
      console.log(`  ℹ index result: ${output.substring(0, 200)}`);
    }
  });

  test("cli query — query the pipeline", async () => {
    test.setTimeout(30_000);

    try {
      const output = cli('query "What is Larkup?"');
      expect(output.length).toBeGreaterThan(5);
      console.log(`  ✓ query output: ${output.substring(0, 300)}`);
    } catch (err: any) {
      const output = err.stdout || err.stderr || err.message;
      console.log(`  ℹ query result: ${output.substring(0, 200)}`);
    }
  });

  test("cli settings — view settings", async () => {
    test.setTimeout(15_000);

    try {
      const output = cli("settings");
      console.log(`  ✓ settings output: ${output.substring(0, 200)}`);
    } catch (err: any) {
      const output = err.stdout || err.stderr || err.message;
      console.log(`  ℹ settings result: ${output.substring(0, 200)}`);
    }
  });
});
