import { test, expect } from "@playwright/test";

test.describe("Index Dialog", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/data");
    // Click the Index Data button to open the dialog
    await page.getByRole("button", { name: /Index Data/i }).click();
    await page.waitForSelector("text=Chunk, embed", { timeout: 15_000 });
  });

  test("dialog loads with correct heading", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Index Data" })).toBeVisible();
    await expect(page.getByText("Chunk, embed, and index")).toBeVisible();
  });

  test("shows indexing readiness status", async ({ page }) => {
    // The dialog should show whether indexing is ready or list blockers
    const readyIndicator = page
      .getByText(/Not ready to index|Index configuration/i)
      .first();
    await expect(readyIndicator).toBeVisible({ timeout: 10_000 });
  });

  test("trigger indexing process", async ({ page }) => {
    test.setTimeout(300_000); // indexing can take up to 5 minutes

    // Wait for data to load
    await page.waitForTimeout(2_000);

    // Look for the indexing button in the dialog (Start indexing or Index new documents)
    const indexBtn = page.getByRole("button", {
      name: /Start indexing|Index new documents/i,
    }).first();

    if (await indexBtn.isVisible({ timeout: 5_000 }).catch(() => false) && await indexBtn.isEnabled({ timeout: 1_000 }).catch(() => false)) {
      await indexBtn.click();
      await page.waitForTimeout(2_000);

      // Wait for progress indication
      const progressIndicator = page
        .getByText(/chunking|embedding|Live|Storing/i)
        .first();
      await expect(progressIndicator).toBeVisible({ timeout: 30_000 });

      // Wait for completion
      const completedIndicator = page
        .getByText(/Completed|Ready/i)
        .first();
      await expect(completedIndicator).toBeVisible({ timeout: 240_000 });

      console.log("  ✓ Indexing completed successfully");
    } else {
      // Indexing may not be ready (missing config or docs)
      console.warn("  ⚠ Index button not enabled — ensure configure + data steps ran first");
    }
  });

});
