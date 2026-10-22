# pkgdb

Builds the package registry of the build farm from a binary index file and a text manifest.

```
pkgdb <index.bin> <manifest.txt>
```

The index comes from the package server. The manifest is local: it adds packages and can override index entries.

## Manifest

One package per line, four fields separated by spaces: `name path flags extends`. `flags` is hex. `extends` is `-` in this version.
