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

The SDK supports health and OpenAPI discovery, retrieval, document CRUD, sequential or parallel bulk indexing with progress, corpus filtering and export, scraping, and streaming chat grounded in retrieved content. `AsyncLarkupClient` provides matching asynchronous methods.

## Agent Server

In **Settings → Runtime**, select **Agent** and start the server. Then use its
displayed URL.
Open `<displayed-url>/reference` for the interactive Scalar API reference or
`<displayed-url>/openapi.json` for the OpenAPI document:

```python
import os

from larkup import LarkupAgentClient

agent = LarkupAgentClient(
    base_url="http://localhost:8080",
    api_key=os.environ["LARKUP_API_KEY"],
)
print(agent.health())
for capability in agent.capabilities():
    print(capability.name, capability.tools)
print(agent.configuration().systemPrompt)
print(agent.sandbox())
for text in agent.stream_text("Hello"):
    print(text, end="", flush=True)
```

### Select an available chat model

Generated runtimes expose their usable chat catalog through the SDK. Model
selection is per request, so it does not mutate the deployment default.

```python
from larkup import AgentChatRequest

catalog = agent.chat_model_catalog()
models = agent.chat_models("anthropic")

if models:
    print(agent.chat_text(AgentChatRequest(
        messages=[{"role": "user", "content": "Summarize the project."}],
        provider=catalog.configuredProvider,
        modelId=models[0].id,
    )))
```

AI Gateway runtimes can select any language model returned by the catalog;
direct-provider runtimes are limited to their configured provider. See the
[Vercel AI Gateway model catalog](https://vercel.com/ai-gateway/models) for current providers and models.

`LarkupHubClient` and `AsyncLarkupHubClient` provide typed Marketplace catalog discovery. Install and uninstall operations remain in the CLI because they change the local Larkup tool directory.

See the [Python SDK documentation](https://www.larkup.de/docs/sdk/python) for the complete guide.

## Development

```bash
cd apps/sdk/py-sdk
uv run pytest
```
