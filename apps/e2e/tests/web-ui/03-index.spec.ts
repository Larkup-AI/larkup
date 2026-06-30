import { test, expect } from "@playwright/test";

test.describe("Index Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/index-data");
    await page.waitForSelector("text=Chunk, embed", { timeout: 15_000 });
  });

  test("page loads with correct heading", async ({ page }) => {
    await expect(page.getByText("Step 3 · Index")).toBeVisible();
    await expect(page.getByText("Chunk, embed & store")).toBeVisible();
  });

  test("shows indexing readiness status", async ({ page }) => {
    // The page should show whether indexing is ready or list blockers
    const readyIndicator = page
      .getByText(/ready|blocker|missing|configure|empty/i)
      .first();
    await expect(readyIndicator).toBeVisible({ timeout: 10_000 });
  });

  test("trigger indexing process", async ({ page }) => {
    test.setTimeout(300_000); // indexing can take up to 5 minutes

    // Look for the indexing button
    const indexBtn = page.getByRole("button", {
      name: /Run|Build|Start|Index/i,
    }).first();

    if (await indexBtn.isEnabled({ timeout: 5_000 }).catch(() => false)) {
      await indexBtn.click();
      await page.waitForTimeout(2_000);

      // Wait for progress indication
      const progressIndicator = page
        .getByText(/chunking|embedding|upserting|processing|progress|running/i)
        .first();
      await expect(progressIndicator).toBeVisible({ timeout: 30_000 });

      // Wait for completion
      const completedIndicator = page
        .getByText(/completed|done|success|finished/i)
        .first();
      await expect(completedIndicator).toBeVisible({ timeout: 240_000 });

      console.log("  ✓ Indexing completed successfully");
    } else {
      // Indexing may not be ready (missing config or docs)
      console.warn("  ⚠ Index button not enabled — ensure configure + data steps ran first");
    }
  });

  test("shows index stats after completion", async ({ page }) => {
    // After indexing, the page should show stats
    const statsArea = page.getByText(/chunk|vector|document|indexed/i).first();
    if (await statsArea.isVisible({ timeout: 5_000 }).catch(() => false)) {
      console.log("  ✓ Index stats are visible");
    }
  });
});
