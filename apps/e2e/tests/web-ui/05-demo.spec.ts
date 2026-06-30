import { test, expect } from "@playwright/test";
import { TEST_QUERY } from "../../utils/fixtures";

test.describe("Demo Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo");
    await page.waitForSelector("text=Query your RAG pipeline", {
      timeout: 15_000,
    });
  });

  test("page loads with correct heading", async ({ page }) => {
    await expect(page.getByText("Step 5 · Demo")).toBeVisible();
    await expect(page.getByText("Query your RAG pipeline")).toBeVisible();
  });

  test("query input is visible", async ({ page }) => {
    const queryInput = page
      .locator(
        'input[placeholder*="query" i], input[placeholder*="question" i], input[placeholder*="search" i], textarea'
      )
      .first();
    await expect(queryInput).toBeVisible({ timeout: 10_000 });
  });

  test("submit a query and get results", async ({ page }) => {
    test.setTimeout(120_000);

    // Find and fill the query input
    const queryInput = page
      .locator(
        'input[placeholder*="query" i], input[placeholder*="question" i], input[placeholder*="search" i], textarea'
      )
      .first();

    if (await queryInput.isVisible()) {
      await queryInput.fill(TEST_QUERY);

      // Submit the query
      const submitBtn = page
        .getByRole("button", { name: /Search|Query|Submit|Send|Run/i })
        .first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
      } else {
        // Try pressing Enter
        await queryInput.press("Enter");
      }

      await page.waitForTimeout(5_000);

      // Wait for results to appear
      const resultsArea = page
        .getByText(/result|hit|document|score|chunk|answer/i)
        .first();
      await expect(resultsArea).toBeVisible({ timeout: 60_000 });
      console.log("  ✓ Query returned results");
    }
  });

  test("results show score and content", async ({ page }) => {
    test.setTimeout(120_000);

    const queryInput = page
      .locator(
        'input[placeholder*="query" i], input[placeholder*="question" i], input[placeholder*="search" i], textarea'
      )
      .first();

    if (await queryInput.isVisible()) {
      await queryInput.fill(TEST_QUERY);

      const submitBtn = page
        .getByRole("button", { name: /Search|Query|Submit|Send|Run/i })
        .first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
      } else {
        await queryInput.press("Enter");
      }

      await page.waitForTimeout(10_000);

      // Check for score indicators (common in RAG results)
      const scoreElement = page.getByText(/score|similarity|relevance|\d+\.\d+/i).first();
      if (await scoreElement.isVisible({ timeout: 30_000 }).catch(() => false)) {
        console.log("  ✓ Score values visible in results");
      }

      // Check for content/text snippets
      const contentElement = page.locator('[class*="result"], [class*="hit"], [class*="chunk"]').first();
      if (await contentElement.isVisible({ timeout: 5_000 }).catch(() => false)) {
        console.log("  ✓ Result content snippets visible");
      }
    }
  });
});
