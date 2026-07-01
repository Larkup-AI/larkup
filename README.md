<div align="center">
  <img src="./apps/web/public/logo-light.png" alt="Larkup RAG Logo" width="400" />

  <br />

**Open-source RAG infrastructure — ingest, index, and deploy production-ready vector search APIs in minutes.**

[Documentation](https://larkuprag.larkup.de/docs) · [GitHub Issues](https://github.com/Larkup-AI/larkup-rag/issues)

</div>

---

## ⚡ Getting Started

### Option 1: Docker (recommended)

```bash
docker run -d -p 4567:4567 \
  -e OPENAI_API_KEY=your_key \
  ghcr.io/larkup-ai/larkup-rag:latest
```

Or with Docker Compose:

```bash
git clone https://github.com/Larkup-AI/larkup-rag.git
cd larkup-rag
docker-compose up -d
```

### Option 2: From source

```bash
git clone https://github.com/Larkup-AI/larkup-rag.git
cd larkup-rag
pnpm install
pnpm dev
```

Open **http://localhost:4567** → Configure your vector store & embeddings → Add documents → Run ETL → Chat.

---

## 🔌 SDK Integration

Install the SDK for your language:

```bash
# TypeScript / Node.js
npm install @larkup/rag-sdk

# Python
pip install larkup-rag
```

### Vercel AI SDK

```typescript
import { tool } from "ai";
import { z } from "zod";
import { LarkupRAGClient } from "@larkup/rag-sdk";

const rag = new LarkupRAGClient({
  baseUrl: "http://localhost:8080",
  apiKey: "your-api-key",
});

export const ragTool = tool({
  description: "Search the knowledge base for relevant context.",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    const results = await rag.query(query, 5);
    return results.hits.map((hit) => hit.text).join("\n\n");
  },
});
```

### LangChain (Python)

```python
from langchain_core.retrievers import BaseRetriever
from langchain_core.documents import Document
from larkup_rag import LarkupRAGClient, LarkupRAGClientOptions

class LarkupRetriever(BaseRetriever):
    client: LarkupRAGClient

    def _get_relevant_documents(self, query: str, **kwargs):
        results = self.client.query(query, top_k=5)
        return [
            Document(page_content=hit.text, metadata={"score": hit.score})
            for hit in results.hits
        ]

retriever = LarkupRetriever(
    client=LarkupRAGClient(LarkupRAGClientOptions(
        base_url="http://localhost:8080", api_key="your-api-key"
    ))
)
docs = retriever.invoke("What is Larkup RAG?")
```

### OpenAI-Compatible Endpoint

Every Larkup RAG server exposes an OpenAI-compatible API — use it with any framework that supports custom base URLs:

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const larkup = createOpenAI({
  baseURL: "http://localhost:8080/v1",
  apiKey: "your-api-key",
});

const { text } = await generateText({
  model: larkup("rag-model"),
  prompt: "What is LarkupRAG?",
});
```

---

## 🏗️ Architecture

| Package | Description |
|---|---|
| `apps/web` | Web UI & API server — configure pipelines, ingest data, deploy |
| `apps/cli` | CLI to init, index, and query pipelines from the terminal |
| `apps/sdk/js-sdk` | TypeScript/JS SDK (`@larkup/rag-sdk`) |
| `apps/sdk/py-sdk` | Python SDK (`larkup-rag`) |
| `apps/docs` | Documentation site (Mintlify) |

---

## 📚 Documentation

Full guides on configuration, data ingestion, deployment, and SDK integrations → [larkuprag.larkup.de/docs](https://larkuprag.larkup.de/docs)

## 🤝 Contributing

We welcome contributions! Open an [issue](https://github.com/Larkup-AI/larkup-rag/issues) or submit a pull request.

## 📄 License

[MIT](./LICENSE) — Copyright (c) 2024-2026 Larkup UG
