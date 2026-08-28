---
'@larkup/core': patch
'@larkup/cli': patch
'@larkup/marketplace': patch
'@larkup/sdk': patch
'larkup': patch
---

Improve project settings with portable Agent Skills, runtime filtering, current installed-tool manifests, and expanded Video Intelligence configuration. Agent Server deployments now expose tool discovery plus AI SDK and OpenAI-compatible streaming endpoints, grouped separately from Knowledge endpoints in Scalar. Add text streaming helpers, chat-model discovery, and guarded per-request provider/model selection to the JavaScript and Python SDK clients. AI Gateway runtimes list their available language models; direct-provider runtimes remain constrained to their configured provider. Align `larkup chat --model` with the configured provider so a Gateway key is never routed to a direct vendor.
