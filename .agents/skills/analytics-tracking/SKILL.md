---
name: analytics-tracking
description: Instructions for tracking usage analytics when adding AI features or making requests to the RAG server.
tags: analytics, tracking, metrics
---

# Usage Analytics Tracking

Whenever adding a new feature that uses AI models (chat, completions, or embeddings) or makes requests to the RAG server, you MUST track its usage asynchronously.

Import the tracking function:
```ts
import { trackUsageEvent } from "@larkup/core/analytics-store"
```

Call it in a fire-and-forget manner so it doesn't block the request path:
```ts
void trackUsageEvent({
  type: "chat", // or "embedding", "server_request"
  // ... relevant fields (modelId, promptTokens, completionTokens)
  timestamp: new Date().toISOString(),
})
```

**Why this matters**:
Larkup relies heavily on accurate analytics to help users understand the cost and efficiency of their Custom AI APIs. Ensure that tokens consumed during embedding or querying are passed accurately to `trackUsageEvent`.
