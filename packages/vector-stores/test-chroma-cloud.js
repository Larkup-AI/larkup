const { CloudClient } = require("chromadb");

async function run() {
  const client = new CloudClient({
    apiKey: "wrong-key-1234",
    tenant: "bogus-tenant-123",
    database: "bogus-db-123"
  });

  try {
    console.log("heartbeat:", await client.heartbeat());
    console.log("getOrCreateCollection...");
    await client.getOrCreateCollection({
      name: "documents"
    });
    console.log("Success!");
  } catch (err) {
    console.error("Error:", err.message);
  }
}
run();
