# @larkup/workspace-ui

Shared, data-source-agnostic presentation components for the Larkup workspace.
Larkup Local and Larkup Cloud both consume this package; product-specific API,
storage, authentication, and deployment logic stays in each application.

The package owns page composition, spacing, navigation, empty states, and the
chat/data/settings shells. It does not call Local or Cloud APIs.

The published entry point is compiled ESM with declarations. Local Turborepo
builds and watches it as a normal workspace dependency; Cloud's sync command
builds and content-addresses the same source before packing it.
