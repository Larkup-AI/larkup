async function globalTeardown() {
  console.log("\n🧹 E2E Global Teardown");

  // Stop RAG server if it was launched during tests
  try {
    const res = await fetch("http://localhost:4567/api/server/local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
    if (res.ok) {
      console.log("  ✓ Stopped RAG server");
    }
  } catch {
    // RAG server wasn't running — that's fine
  }

  console.log("  ✓ Global teardown complete\n");
}

export default globalTeardown;
