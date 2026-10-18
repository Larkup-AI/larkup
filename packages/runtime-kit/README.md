# Runtime kit

Dependency-free assets shared by Local generated agent servers and Cloud managed deployments. `widgetScript({ widget })` returns the browser script for `/widget.js`; it calls the host agent's `/chat` endpoint. `reactWidgetSnippet` produces the React integration and cleanup lifecycle. `agentSdkSnippet` uses the public `LarkupAgentClient` API. Authorization, allowed origins, rate limits, and credentials belong to the host.
