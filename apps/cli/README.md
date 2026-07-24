# Larkup CLI

Build, index, test, and deploy Larkup RAG servers from the terminal.

## Install

```bash
npm install -g @larkup/cli
```

## Workflow

```bash
larkup init product-docs
larkup index ./knowledge
larkup generate
larkup serve
```

`index` accepts files and folders. It loads supported text and source files, processes supported media, and streams indexing progress.

## Commands

- `larkup index [sources...]` loads sources and builds the index.
- `larkup documents` manages and exports corpus documents.
- `larkup media [sources...]` processes image, audio, and video files.
- `larkup serve` runs the generated server.
- `larkup query <question>` retrieves relevant chunks.
- `larkup chat` starts an interactive terminal chat.
- `larkup marketplace` manages Marketplace Hub tools.
- `larkup deploy [target]` prepares Docker, Vercel, local, export, or agent targets.
- `larkup test` validates configuration, storage, or a deployed endpoint.
- `larkup open [target]` opens the Web UI or API reference.
- `larkup update` checks for and installs CLI releases.

Run `larkup --help` or see the [CLI documentation](https://larkup.de/docs/developer/cli) for all options.
