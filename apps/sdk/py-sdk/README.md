# Larkup Python SDK

The official Python client for the **Larkup** platform.

This SDK provides a simple, Pythonic interface to interact with your running Larkup servers. It offers both synchronous and asynchronous clients, built on top of `httpx` and `pydantic`.

## Installation

Install the package via pip or uv:

```bash
pip install larkup
# or
uv pip install larkup
```

## Quick Start

### Synchronous Client

```python
from larkup import LarkupClient

# Initialize the client
client = LarkupClient(base_url="http://localhost:4567")

# 1. Query the RAG Pipeline
response = client.query(
    query="What is Larkup?",
    top_k=5
)
for hit in response.hits:
    print(hit.document.content)

# 2. Add Documents to the Pipeline
client.documents.add(
    content="Larkup is building a new learning system for the AI Era.",
    metadata={"source": "manual-entry"}
)

# 3. Trigger Indexing
client.index()
print("Documents indexed successfully.")
```

### Asynchronous Client

```python
import asyncio
from larkup import AsyncLarkupClient

async def main():
    client = AsyncLarkupClient(base_url="http://localhost:4567")
    
    response = await client.query(
        query="What is the future of education?",
        top_k=3
    )
    print(response.hits)

asyncio.run(main())
```

## Features

- **Sync & Async Support**: Use `LarkupClient` or `AsyncLarkupClient`.
- **Querying**: Execute semantic searches against your vector store.
- **Data Ingestion**: Add documents and web pages programmatically.
- **Strong Typing**: Built with Pydantic for validation and editor autocompletion.

## Documentation

For full API reference and advanced usage, visit the [Larkup Documentation](https://larkup.de/docs).
