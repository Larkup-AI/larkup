# Larkup JavaScript SDK

The official JavaScript/TypeScript client for the **Larkup** platform. 

This SDK provides a convenient interface to connect your Node.js or browser applications to a running Larkup server. It abstracts away the API layer so you can focus on building your AI agents and applications.

## Installation

Install the SDK via npm, yarn, or pnpm:

```bash
npm install @larkup/sdk
```

## Quick Start

Initialize the `LarkupClient` with the URL of your running Larkup server. 

```typescript
import { LarkupClient } from "@larkup/sdk";

// Initialize the client
const client = new LarkupClient({
  baseUrl: "http://localhost:4567", // Replace with your deployed server URL
});

async function main() {
  // 1. Query the RAG Pipeline
  const queryResponse = await client.query({
    query: "What is Larkup?",
    topK: 5
  });

  console.log("Retrieved Documents:", queryResponse.hits);

  // 2. Add Documents to the Pipeline
  await client.documents.add({
    content: "Larkup is building a new learning system for the AI Era.",
    metadata: { source: "manual-entry" }
  });
  
  // 3. Trigger Indexing
  await client.index();
  console.log("Documents indexed successfully.");
}

main();
```

## Features

- **Querying**: Easily execute semantic searches against your vector store.
- **Data Ingestion**: Add text, URLs, and files programmatically.
- **Indexing**: Trigger ETL pipelines to chunk and embed documents on the fly.
- **TypeScript Support**: Full type safety out-of-the-box.

## Documentation

For full API reference and advanced usage, visit the [Larkup Documentation](https://larkup.de/docs).
