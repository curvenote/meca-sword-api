# @curvenote/sword-common

Shared pieces for the MECA SWORD client and server:

- SWORD v3 types (`ServiceDocument`, `StatusDocument`, `MetadataDocument`, `ErrorDocument`) and URIs (`State`, `Packaging`, `Rel`, `FileState`, `MetadataFormat`)
- `SwordError` and the spec's error types mapped to HTTP status codes
- `Content-Disposition` and `Digest` header parsing/formatting, `computeDigest` (WebCrypto)

The Node-only subpath `@curvenote/sword-common/meca` adds:

- `inspectMeca(zip)`: structural MECA check plus manifest, transfer and JATS article metadata
- `mecaToMetadata(inspection)`: map that onto a SWORD Dublin Core metadata document
- `buildMeca({ article, files, transfer })`: build a MECA zip with a generated `manifest.xml`
- `buildMecaFromFiles(files)`: build one from loose files (or a zip of them), inferring each file's role
- `setTransfer(zip, transfer)`: replace a package's `transfer.xml` and update its manifest
