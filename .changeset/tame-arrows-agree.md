---
"larkup": patch
"@larkup/cli": patch
"@larkup/vector-stores": patch
---

Pin Apache Arrow to the range supported by LanceDB to prevent npm peer-dependency warnings during installation. Include public images in the standalone server bundle so logos and icons load after installing Larkup from npm.
