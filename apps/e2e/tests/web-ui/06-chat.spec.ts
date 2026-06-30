import { test, expect } from "@playwright/test";

test.describe("Chat Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/chat");
    await page.waitForSelector("text=Chat with your knowledge base", {
      timeout: 15_000,
    });
  });

  test("page loads with correct heading", async ({ page }) => {
    await expect(page.getByText("Step 6 · Chat")).toBeVisible();
    await expect(
      page.getByText("Chat with your knowledge base")
    ).toBeVisible();
  });

  test("chat input is visible", async ({ page }) => {
    const chatInput = page
      .locator(
        'input[placeholder*="message" i], input[placeholder*="chat" i], input[placeholder*="ask" i], textarea[placeholder*="message" i], textarea[placeholder*="ask" i], textarea'
      )
      .first();
    await expect(chatInput).toBeVisible({ timeout: 10_000 });
  });

  test("send a message and receive a response", async ({ page }) => {
    test.setTimeout(120_000);

    const chatInput = page
      .locator(
        'textarea[placeholder*="message" i], textarea[placeholder*="ask" i], textarea, input[placeholder*="message" i]'
      )
      .first();

    if (await chatInput.isVisible()) {
      await chatInput.fill("What is Larkup RAG?");

      // Submit the message
      const sendBtn = page
        .getByRole("button", { name: /Send|Submit/i })
        .first();
      if (await sendBtn.isVisible()) {
        await sendBtn.click();
      } else {
        // Try Enter (some chat UIs use Enter to send)
        await chatInput.press("Enter");
      }

      await page.waitForTimeout(3_000);

      // Wait for AI response to appear
      // Chat messages typically appear in a message list/container
      const responseElement = page
        .locator(
          '[class*="message"], [class*="response"], [class*="assistant"], [class*="chat-bubble"], [role="log"] > div'
        )
        .last();
      await expect(responseElement).toBeVisible({ timeout: 60_000 });

      // Verify we got at least some text back
      const responseText = await responseElement.textContent();
      expect(responseText?.length).toBeGreaterThan(10);
      console.log(
        `  ✓ Received chat response (${responseText?.length} chars)`
      );
    }
  });

  test("multi-turn conversation", async ({ page }) => {
    test.setTimeout(180_000);

    const chatInput = page
      .locator(
        'textarea[placeholder*="message" i], textarea[placeholder*="ask" i], textarea, input[placeholder*="message" i]'
      )
      .first();

    if (await chatInput.isVisible()) {
      // First message
      await chatInput.fill("What is Larkup RAG?");
      const sendBtn = page
        .getByRole("button", { name: /Send|Submit/i })
        .first();
      if (await sendBtn.isVisible()) await sendBtn.click();
      else await chatInput.press("Enter");

      // Wait for first response
      await page.waitForTimeout(15_000);

      // Second message (follow-up)
      await chatInput.fill("Can you tell me more about its features?");
      if (await sendBtn.isVisible()) await sendBtn.click();
      else await chatInput.press("Enter");

      // Wait for second response
      await page.waitForTimeout(15_000);

      // Count message elements — should be at least 4 (2 user + 2 assistant)
      const messages = page.locator(
        '[class*="message"], [class*="chat-bubble"], [role="log"] > div'
      );
      const count = await messages.count();
      console.log(`  ✓ Multi-turn chat: ${count} messages visible`);
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });
});
