import { ChromaClient, CloudClient, AdminClient } from "chromadb";

async function run() {
  const adminClient = new AdminClient({
    path: "http://localhost:8000"
  });

  try {
    const tenant = await adminClient.getTenant({ name: "bogus-tenant" });
    console.log("Tenant:", tenant);
  } catch (err) {
    console.error("AdminClient error:", err.message);
  }
}
run();
