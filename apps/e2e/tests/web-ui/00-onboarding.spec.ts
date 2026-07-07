import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const rootWorkspaceFile = path.join(process.cwd(), "../../.ragtoolkit/workspace.json");
const rootWorkspaceBackup = path.join(process.cwd(), "../../.ragtoolkit/workspace.json.bak");
const webWorkspaceFile = path.join(process.cwd(), "../web/.ragtoolkit/workspace.json");
const webWorkspaceBackup = path.join(process.cwd(), "../web/.ragtoolkit/workspace.json.bak");

function backupWorkspaces() {
  if (fs.existsSync(rootWorkspaceFile)) fs.copyFileSync(rootWorkspaceFile, rootWorkspaceBackup);
  if (fs.existsSync(webWorkspaceFile)) fs.copyFileSync(webWorkspaceFile, webWorkspaceBackup);
}

function restoreWorkspaces() {
  if (fs.existsSync(rootWorkspaceBackup)) {
    fs.copyFileSync(rootWorkspaceBackup, rootWorkspaceFile);
    fs.unlinkSync(rootWorkspaceBackup);
  }
  if (fs.existsSync(webWorkspaceBackup)) {
    fs.copyFileSync(webWorkspaceBackup, webWorkspaceFile);
    fs.unlinkSync(webWorkspaceBackup);
  }
}

function clearWorkspaces() {
  if (fs.existsSync(rootWorkspaceFile)) fs.unlinkSync(rootWorkspaceFile);
  if (fs.existsSync(webWorkspaceFile)) fs.unlinkSync(webWorkspaceFile);
}

test.describe("Onboarding Flow", () => {
  // Backup workspace before tests
  test.beforeAll(() => backupWorkspaces());

  // Restore workspace after tests
  test.afterAll(() => restoreWorkspaces());

  // Ensure fresh state before each test
  test.beforeEach(() => clearWorkspaces());

  test("Simple Mode Setup Flow — Cloud Provider", async ({ page }) => {
    // Mock the provider test endpoint so we don't actually hit OpenAI
    await page.route("**/api/config/test-provider", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, dimensions: 1536 }),
      });
    });

    await page.goto("/");
    
    // Welcome Screen
    await expect(page.getByText("Welcome to Larkup RAG")).toBeVisible();
    await expect(page.getByText("Simple Mode")).toBeVisible();
    
    // Select Simple Mode
    await page.getByText("Simple Mode").click();

    // Simple Setup Screen
    await expect(page.getByText("Connect your AI")).toBeVisible();

    // Verify API key is required
    const getStartedBtn = page.getByRole("button", { name: /Get Started/i });
    await expect(getStartedBtn).toBeDisabled();

    // Fill API key
    await page.locator('input[placeholder="sk-..."]').fill("sk-mock-e2e-key");

    // Click Verify API Key
    const verifyBtn = page.getByRole("button", { name: /Verify API Key/i });
    await verifyBtn.click();

    // Should show success (use .first() because sonner toast also appears)
    await expect(page.getByText(/API key verified/i).first()).toBeVisible();

    // Get Started should now be enabled
    await expect(getStartedBtn).toBeEnabled();

    // Complete setup
    await getStartedBtn.click();

    // Should redirect to simple chat
    await expect(page).toHaveURL(/\/simple\/chat/);
    await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();
  });

  test("Simple Mode Setup Flow — Custom Model", async ({ page }) => {
    // Mock the embedding and LLM test endpoints
    await page.route("**/api/config/test-embedding", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, dimensions: 384 }),
      });
    });
    await page.route("**/api/config/test-llm", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, text: "OK" }),
      });
    });

    await page.goto("/");
    
    // Go to Simple Mode
    await page.getByText("Simple Mode").click();

    // Switch to Custom Model tab
    await page.getByText("Custom Model").click();

    // Embedding Connection
    await page.locator('input[id="emb-model"]').fill("nomic-test");
    await page.getByRole("button", { name: /Test Connection/i }).click();
    await expect(page.getByText(/Connected — 384 dimensions/i).first()).toBeVisible();

    // LLM Connection
    await page.locator('input[id="llm-model"]').fill("llama-test");
    await page.getByRole("button", { name: /Test LLM Connection/i }).click();
    await expect(page.getByText(/LLM connected successfully/i).first()).toBeVisible();

    // Submit
    const getStartedBtn = page.getByRole("button", { name: /Get Started/i });
    await expect(getStartedBtn).toBeEnabled();
    await getStartedBtn.click();

    // Should redirect to simple chat
    await expect(page).toHaveURL(/\/simple\/chat/);
  });

  test("Developer (Tech) Mode Setup Flow", async ({ page }) => {
    await page.goto("/");

    // Welcome Screen
    await expect(page.getByText("Welcome to Larkup RAG")).toBeVisible();
    await expect(page.getByText("Developer Mode")).toBeVisible();
    
    // Select Tech Mode
    await page.getByText("Developer Mode", { exact: true }).click();

    // Tech Setup Screen
    await expect(page.getByText("Set up your workspace")).toBeVisible();

    // Fill form
    await page.locator('input[id="tech-name"]').fill("E2E User");
    await page.locator('input[id="tech-server"]').fill("e2e-rag-server");

    // Submit
    await page.getByRole("button", { name: /Create my first server/i }).click();

    // Should redirect to configure page (tech mode dashboard)
    await expect(page).toHaveURL(/\/configure/);
    await expect(page.getByText("Pipeline configuration")).toBeVisible();
  });
});
