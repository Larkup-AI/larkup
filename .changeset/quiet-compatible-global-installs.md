---
'larkup': patch
'@larkup/cli': patch
'@larkup/marketplace': patch
'@larkup/sandbox': patch
'@larkup/vector-stores': patch
---

Keep global installs and updates quiet and compatible by aligning Apache Arrow with LanceDB's
supported peer range, shipping the marketplace TypeScript runtime loader, and using the renamed
Daytona SDK package. Public tarballs also scrub local project state from all traced workspaces.
