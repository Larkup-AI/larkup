import { test, expect } from "@playwright/test";
const WEB_UI_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:4567";

test.describe("Desktop App E2E - Splash Screen", () => {
  test("renders splash screen elements", async ({ page }) => {
    // For desktop, we navigate to the local frontend path or mock it
    // Wait for the splash screen to render
    await page.goto(WEB_UI_URL);

    // Verify Larkup title exists
    await expect(page.locator("h1", { hasText: "Larkup" })).toBeVisible();

    // Verify subtitle text
    await expect(
      page.locator(".subtitle", { hasText: "Starting Larkup Studio..." }),
    ).toBeVisible();

    // Verify spinner exists
    await expect(page.locator(".spinner")).toBeVisible();

    // Verify initial status text
    await expect(
      page.locator("#status-text", {
        hasText: "Waiting for the server to boot",
      }),
    ).toBeVisible();
  });
});
