<div align="center">
  <img src="./apps/docs/logo/logo-dark.png" alt="Larkup RAG Logo" width="400" />

  <br />
  <br />

  **The easiest way to launch a production-ready RAG server from local to deployment in minutes.**
</div>

---

## 🌟 What is Larkup RAG?

**Larkup RAG** is an open-source toolkit designed to take you from zero to a running Retrieval-Augmented Generation (RAG) server effortlessly. It eliminates the complexities of manual infrastructure setup, allowing you to seamlessly configure vector stores, chunking strategies, and embedding models through a unified interface.

Part of the broader Larkup ecosystem—"Building a new learning system for the AI Era"—Larkup RAG handles the heavy lifting of ingestion, indexing, and retrieval, so you can focus entirely on building your AI applications.

## 🚀 Features

- **Zero-Config Web UI**: Configure vector databases (e.g., LanceDB, Pinecone, Chroma) and embedding models (e.g., OpenAI, Cohere) visually.
- **Robust Ingestion**: Load data sources easily via local file upload, raw text, or web scraping.
- **Automated Indexing**: Built-in ETL jobs to process, chunk, and embed your loaded data automatically.
- **Local & Cloud Deployments**: Spin up a server locally for fast iteration, and deploy seamlessly to platforms like Vercel or your own VPS.
- **Built-in Demo UI**: Instantly test your retrieval and chat quality before connecting external agents.
- **Language SDKs**: Native JavaScript/TypeScript and Python clients for connecting your AI applications.

## 🏗️ Architecture

The repository is structured as a monorepo, housing the full stack required to run and interact with a Larkup RAG pipeline:

- **`apps/web`**: The Web Interface and API Server. Use this to create workspaces, configure your pipeline, ingest data, and manage deployments.
- **`apps/cli`**: The Command-Line Interface (`@larkup-rag/cli`). Build, index, and query your RAG pipelines directly from your terminal.
- **`apps/sdk/js-sdk`**: The JavaScript/TypeScript SDK (`@larkup-rag/client-js`) for integrating the RAG server into Node.js or browser applications.
- **`apps/sdk/py-sdk`**: The Python SDK (`larkup-rag`) offering both synchronous and asynchronous clients for Python-based AI agents.
- **`apps/docs`**: The Mintlify-powered documentation detailing installation, configuration, and API reference.

## ⚡ Quickstart

Get a RAG server running locally in minutes using the CLI or Web UI:

```bash
# 1. Start the development server
pnpm install
pnpm dev

# 2. Or initialize a project via the CLI
npx @larkup-rag/cli init my-rag-server
```

1. **Launch the Web UI**: Open `http://localhost:4567`
2. **Configure**: Select your Vector Store and Embedding Provider.
3. **Ingest**: Add documents or scrape URLs in the Data tab.
4. **Index**: Run the ETL pipeline to process your documents.
5. **Chat**: Test your pipeline using the built-in Chat Demo.

## 📚 Documentation

For comprehensive guides on configuration, data ingestion, testing, and SDK integrations, please refer to our [Official Documentation](https://larkup.de/docs).

## 🤝 Contributing

We welcome contributions! Please open issues or submit pull requests to help improve the RAG server, add support for new vector databases, or enhance the SDKs.
