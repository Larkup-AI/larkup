---
'larkup': patch
'@larkup/cli': patch
---

Pin the Next.js runtime to the exact version used to build the standalone npm package, preventing fresh curl and global npm installs from loading incompatible generated output.

Make CSV chart routing deterministic for smaller models, and keep Docker's native LanceDB and canvas bindings aligned with the web package without obsolete optional runtime dependencies.

Prevent the CLI's background Enterprise update check from creating and activating a default project while `larkup init` creates the requested project.
