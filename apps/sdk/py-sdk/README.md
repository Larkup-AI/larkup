# Larkup Python SDK

The synchronous and asynchronous Python clients for a generated Larkup server.

## Install

```bash
pip install larkup
```

## Use

```python
from larkup import LarkupClient, LarkupClientOptions

client = LarkupClient(
    LarkupClientOptions(
        base_url="http://localhost:8080",
        api_key="your-api-key",
    )
)

result = client.query("What is Larkup?", top_k=5)

for event in client.chat("Summarize the result."):
    if event.type == "text-delta":
        print(event.text or "", end="", flush=True)
```

The SDK supports health checks, retrieval, document CRUD, scraping, and streaming retrieval-grounded chat. `AsyncLarkupClient` provides matching asynchronous methods.

See the [Python SDK documentation](https://larkup.de/docs/sdk/python) for the complete guide.
