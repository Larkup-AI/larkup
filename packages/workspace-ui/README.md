# @larkup/workspace-ui

Shared, data-source-agnostic presentation components for the Larkup workspace.
Larkup Local and Larkup Cloud both consume this package; product-specific API,
storage, authentication, and deployment logic stays in each application.

The package owns page composition, spacing, navigation, empty states, and the
chat/data/settings shells. It does not call Local or Cloud APIs.

The published entry point is compiled ESM with declarations. Local Turborepo
builds and watches it as a normal workspace dependency; Cloud's sync command
builds and content-addresses the same source before packing it.

## Host adapters

`GeneralSettingsView` accepts name and appearance state, save callbacks, and an optional cache-management slot. It never fetches credentials or assumes a local filesystem. Both hosts render this same view. Import `ThemeCustomizerProvider` once above the workspace and use `useThemeCustomizer` to supply appearance state.

`provider-icon` exports the canonical provider metadata and logo renderer; bundled logos are self-contained. Import `theme.css`, `themes.css`, and `source.css` once in the host stylesheet. `source.css` registers package classes with Tailwind. The `button`, `label`, and `select` subpaths expose Local's controls.
