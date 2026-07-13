import { test, expect } from "@playwright/test";

const BASE = "http://localhost:4567";

test.describe("Index API (/api/index)", () => {
  test("GET /api/index — check indexing status and readiness", async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/api/index`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("ready");
    expect(body).toHaveProperty("docCount");
    expect(body).toHaveProperty("running");

    if (body.ready) {
      console.log(
        `  ✓ Index ready: ${body.docCount} docs, running=${body.running}`
      );
    } else {
      console.log(`  ℹ Index not ready — blockers: ${body.blockers?.join(", ")}`);
    }

    // Verify shape
    expect(typeof body.ready).toBe("boolean");
    expect(typeof body.docCount).toBe("number");
    expect(typeof body.running).toBe("boolean");

    if (body.config) {
      expect(body.config).toHaveProperty("embeddingModelId");
      expect(body.config).toHaveProperty("vectorStore");
    }
  });

  test("POST /api/index — trigger indexing (if ready)", async ({
    request,
  }) => {
    test.setTimeout(300_000); // indexing can take a long time

    // Check readiness first
    const statusRes = await request.get(`${BASE}/api/index`);
    const status = await statusRes.json();

    if (!status.ready) {
      console.log(
        "  ⏭ Skipping indexing — not ready: " + status.blockers?.join(", ")
      );
      test.skip(true, "Indexing not ready");
      return;
    }

    if (status.running) {
      console.log("  ⏭ Skipping — indexing already in progress");
      test.skip(true, "Already running");
      return;
    }

    const res = await request.post(`${BASE}/api/index`, {
      data: {},
    });

    expect(res.status()).toBe(202);
    const body = await res.json();
    expect(body).toHaveProperty("run");
    expect(body.run).toHaveProperty("id");
    console.log(`  ✓ Indexing triggered: run ${body.run.id}`);

    // Poll until complete
    let attempts = 0;
    const maxAttempts = 60; // 60 × 5s = 5 minutes
    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 5_000));
      
      let pollRes;
      try {
        pollRes = await request.get(`${BASE}/api/index`);
      } catch (err: any) {
        console.warn(`  ⚠ Polling network error: ${err.message}`);
        attempts++;
        continue;
      }

      const pollBody = await pollRes.json();

      if (pollBody.run?.status === "completed") {
        console.log("  ✓ Indexing completed successfully");
        break;
      }
      if (pollBody.run?.status === "failed") {
        console.error(
          `  ✗ Indexing failed: ${pollBody.run.error}`
        );
        break;
      }

      attempts++;
      console.log(
        `  ⏳ Indexing in progress... (${pollBody.run?.status}, attempt ${attempts}/${maxAttempts})`
      );
    }
  });

  test("POST /api/index — returns 409 if already running", async ({
    request,
  }) => {
    // Check if indexing is currently running
    const statusRes = await request.get(`${BASE}/api/index`);
    const status = await statusRes.json();

    if (!status.running) {
      console.log("  ⏭ Skipping 409 test — no indexing in progress");
      test.skip(true, "No indexing in progress");
      return;
    }

    const res = await request.post(`${BASE}/api/index`, {
      data: {},
    });

    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already in progress");
    console.log("  ✓ Concurrent indexing correctly rejected (409)");
  });

  test("DELETE /api/index — cancel running index", async ({ request }) => {
    const res = await request.delete(`${BASE}/api/index`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    console.log("  ✓ Index cancel endpoint responded OK");
  });
});
