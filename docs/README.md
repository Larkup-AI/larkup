# Larkup Documentation

This folder contains the Mintlify source for the Larkup documentation.

## Structure

- `index.mdx` contains the home page.
- `guide` contains installation, Quickstart, and use case guides.
- `developer` contains CLI, deployment, and configuration guides.
- `sdk` contains TypeScript, Python, and framework guides.
- `api-reference` contains the generated server API reference.
- `docs.json` controls navigation and site settings.

When a CLI or SDK workflow changes, update its package README and matching page in this folder in the same change.

## Local preview

Install the Mintlify CLI:

```bash
npm install -g mint
```

Start the preview from this directory:

```bash
cd docs
mint dev
```

Open [http://localhost:3000](http://localhost:3000).

## Publishing

Changes are published through the Mintlify GitHub integration after they reach the configured deployment branch.
