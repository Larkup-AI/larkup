# Larkup CLI

Load data, build an index, chat, and deploy Larkup RAG servers from the terminal.

## Install

```bash
npm install -g @larkup/cli
```

## Workflow

```bash
larkup init product-docs
larkup index ./knowledge
larkup dev
```

`index` accepts individual files or folders, including text, source code, CSV, JSON, PDF, and Word documents. It streams loading and indexing progress.

Use the dedicated media command for images, audio, and video:

```bash
larkup marketplace install video-audio
larkup media ./demo.mp4
```

## Commands

- `larkup index [sources...]` loads sources and builds the index.
- `larkup dev [name]` creates a workspace (default: `my-larkup`) and runs its local server.
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

Generated servers use `http://localhost:8080` by default. Run `larkup --help` or see the [CLI documentation](https://www.larkup.de/docs/developer/cli) for all options.
