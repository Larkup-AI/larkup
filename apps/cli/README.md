# Larkup CLI

The official Command Line Interface for **Larkup**. 
Build, index, and serve a Retrieval-Augmented Generation (RAG) pipeline directly from your terminal.

## Installation

You can install the CLI globally via npm or run it via npx:

```bash
npm install -g @larkup/cli
# or
npx @larkup/cli
```

## Usage

The CLI provides a set of commands to manage your RAG workspaces, configure vector stores, ingest documents, and query your data.

```bash
larkup <command> [options]
```

### Core Commands

- **`init [name]`**: Create a new RAG server (workspace project).
- **`config`**: Configure vector stores and embedding models for your active workspace.
- **`add-doc`**: Ingest documents (local files, URLs, or text) into your workspace.
- **`index`**: Process, chunk, and index your ingested documents into the configured vector database.
- **`serve`**: Spin up the generated RAG server locally for fast testing and API integration.
- **`query`**: Test retrieval quality by querying your indexed data directly from the terminal.
- **`chat`**: Start an interactive chat session with your RAG pipeline in the terminal.
- **`generate`**: Generate server configurations or boilerplate code.
- **`settings`**: View or update your global settings and environment variables.

### Managing Workspaces (Servers)

- **`use`**: Switch your active server/workspace context.

## Example Workflow

```bash
# 1. Initialize a new project
larkup init my-rag-server

# 2. Add documents to the project
larkup add-doc ./data/knowledge-base.txt

# 3. Index the documents into the vector store
larkup index

# 4. Start an interactive chat session with your data
larkup chat
```

## Documentation

For more detailed guides and information, please refer to the [Larkup Documentation](https://larkup.de/docs) or visit our [Web UI](https://larkup.de).
