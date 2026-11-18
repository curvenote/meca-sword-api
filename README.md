# MECA over SWORD v3

TypeScript libraries and an app for moving [MECA](https://www.niso.org/publications/rp-30-2020-meca) manuscript packages between systems using the [SWORD 3.0](https://swordapp.github.io/swordv3/swordv3.html) deposit protocol, as an alternative to MECA's usual FTP drop.

Scope follows [swordappv3-server-php](https://github.com/asmecher/swordappv3-server-php) and the [MECA/SWORDv3 working group notes](https://github.com/BirkbeckCTP/meca-swordv3): one MECA zip is one SWORD object.

> [!NOTE]
> **This is a prototype**, Curvenote's reference implementation for exploring MECA transfer over SWORD v3 with other implementations. APIs, the database schema and the MECA packaging URI (`https://meca.zip/sword/package/MECA`, provisional until the working group settles one) may change without notice. The packages aren't published to npm yet. Issues and comments from anyone working on MECA or SWORD are welcome.

| Package                                            | What it is                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`@curvenote/sword-common`](packages/sword-common) | SWORD v3 document types, URIs, error types, header and digest helpers; MECA inspection/builder |
| [`@curvenote/sword-server`](packages/sword-server) | Framework-agnostic SWORD v3 server (`(Request) => Response`) that receives MECA packages       |
| [`@curvenote/sword-client`](packages/sword-client) | SWORD v3 client for depositing MECA packages and tracking their status                         |
| [`@curvenote/sword-cli`](packages/sword-cli)       | `meca-sword` CLI: build, inspect and deposit MECA packages                                     |
| [`@curvenote/meca-sword-app`](apps/meca-sword)     | One app that **receives** (SWORD server + inbox UI) and **uploads & sends** (client + outbox)  |

## Quick start

Needs Bun and Docker (for a local Postgres).

```bash
bun install
bun run dev
```

This builds the libraries (rebuilding them on change), starts Postgres in Docker, applies the database migrations and runs the app at http://localhost:5173. The first run writes `apps/meca-sword/.app-config.secrets.yml` with local secrets.

1. **Sign in** with any email (development only). New people wait for approval: make yourself an active admin by adding `admins: [you@example.org]` to the secrets file and signing in again, or set your row's `status` and `role` in the `User` table.
2. **API keys:** create a key. Systems deposit over SWORD with it, as you.
3. **Packages:** add the JATS XML with its PDF, figures and data (or a folder or zip of them, or an existing MECA zip). The manifest is built for you; title, authors and file roles come from the files.
4. Tick packages, choose **Curvenote (this server) › Reviews** (or another destination) and **Send**. Each package gets a `transfer.xml` addressed to that destination.
5. The deposits appear in the **Inbox**, where an admin can accept or reject them. **Outbox → Refresh** shows the new state.

**Destinations** are other SWORD servers, added by Service-URL with the credentials they gave us (stored encrypted); their name, collections and limits come from the service document.

The CLI deposits without the UI:

```bash
CLI=packages/sword-cli/dist/cli.js
node $CLI example paper-meca.zip
node $CLI build paper.xml paper.pdf figures/ -o paper-meca.zip
node $CLI send paper-meca.zip http://localhost:5173/sword/collections/reviews -k msk_…
```

To run the app elsewhere, build the [`Dockerfile`](Dockerfile); see [Deploying](apps/meca-sword/README.md#deploying).

## SWORD v3 support

| Feature                                                                                               | Status                                                                                              |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Service Document (`GET` Service-URL)                                                                  | Yes                                                                                                 |
| Package deposit (`POST` Service-URL, MECA zip)                                                        | Yes. Requires `Digest: SHA-256=…`; validates the zip is a MECA bundle                               |
| Metadata deposit (`POST`, `metadata=true`)                                                            | Yes. Default SWORD (Dublin Core JSON-LD) format only                                                |
| Status Document (`GET` Object-URL)                                                                    | Yes, with `ETag`                                                                                    |
| Metadata retrieve / replace (`GET`/`PUT` Metadata-URL)                                                | Yes. `PUT` honours `If-Match`                                                                       |
| File retrieve (`GET` File-URL)                                                                        | Yes (the original MECA zip)                                                                         |
| Delete object (`DELETE` Object-URL)                                                                   | Yes                                                                                                 |
| Collections (sub-services in the service document)                                                    | Yes, e.g. journal sections, each with its own Service-URL                                           |
| Authentication                                                                                        | `Authorization: APIKey <key>`, or the key as an HTTP Basic password (pluggable `authenticate` hook) |
| Error documents                                                                                       | Yes, all SWORD error `@type`s with matching HTTP status                                             |
| Append/replace files, By-Reference, segmented upload, On-Behalf-Of, `In-Progress` updates, SWORDBagIt | Not implemented. Requests are refused with the SWORD error the spec prescribes                      |

Generated Service, Status, Metadata and Error documents are checked against the official SWORD JSON schemas in the tests.

### MECA specifics

- **Packaging URI.** Neither SWORD nor NISO define a packaging URI for MECA yet. The client sends `Packaging: https://meca.zip/sword/package/MECA` (`Packaging.MECA` in `sword-common`) when a server advertises it, and falls back to `…/package/Binary` otherwise. The server accepts MECA, Binary and SimpleZip for `application/zip`. This URI is provisional and should change once the working group settles one.
- **Validation.** On deposit the server checks the zip has a parseable `manifest.xml` whose items are all present, and reads `transfer.xml` and the JATS `article-metadata` item. Invalid bundles get `400 ContentMalformed` with the problems in `log`. This is structural; DTD validation (needs `xmllint`) can be plugged in via the server's `inspect` option using `validateMeca` from the [`meca`](https://www.npmjs.com/package/meca) package.
- **Metadata.** The SWORD metadata document for a deposit is derived from the JATS front matter (title, authors, abstract, DOI, journal) and the transfer source.
- **State.** New packages are `inWorkflow`; the receiver moves them to `ingested` or `rejected` (UI buttons, or `server.setState()`), which the sender sees in the status document.

## Development

The repo follows the layout of [jats](https://github.com/continuous-foundation/jats): bun workspaces, turbo, changesets, vitest, prettier and `eslint-config-curvenote`.

```bash
bun install
bun run build       # turbo build of all packages
bun run test        # vitest in every workspace
bun run lint        # eslint
bun run lint:format # prettier --check
bun run dev         # watch builds and run the app with a local Postgres
```

Run `bun run changeset` to record a change to the published libraries.

---

<p style="text-align: center; color: #aaa; padding-top: 50px">
  Made with love by
  <a href="https://curvenote.com" target="_blank" style="color: #aaa">
    <img src="https://cdn.curvenote.com/static/site/curvenote/logo-icon-blue.svg" style="height: 1em" /> Curvenote
  </a>
</p>
