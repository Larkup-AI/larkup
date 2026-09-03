# @larkup/sdk

## 0.3.1

### Patch Changes

- Improve project settings with portable Agent Skills, runtime filtering, current installed-tool manifests, and expanded Video Intelligence configuration. Agent Server deployments now expose tool discovery plus AI SDK and OpenAI-compatible streaming endpoints, grouped separately from Knowledge endpoints in Scalar. Add text streaming helpers, chat-model discovery, and guarded per-request provider/model selection to the JavaScript and Python SDK clients. AI Gateway runtimes list their available language models; direct-provider runtimes remain constrained to their configured provider. Align `larkup chat --model` with the configured provider so a Gateway key is never routed to a direct vendor.

## 0.3.0

### Minor Changes

- 07e35de: Add the evidence-first Video Knowledge Engine foundation: durable revisions and
  jobs, bounded media inspection, source-grounded citations, and public video
  knowledge citation types.

## 0.2.0

### Minor Changes

- efc6810: Add folder and media indexing, corpus management, Marketplace Hub operations, deployment and update commands, browser opening, CLI validation, streaming chat, complete RAG endpoint coverage, bulk SDK indexing progress, and typed Hub discovery.
