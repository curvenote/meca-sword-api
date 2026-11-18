# meca-sword app

One system that both receives MECA packages over SWORD v3 and builds and sends them to other SWORD servers. React Router v7 (server-rendered), Prisma on Postgres, files in GCS (or a local folder in development), configured with app-config.

```bash
bun run dev   # from the repo root: libraries, local Postgres, migrations, http://localhost:5173
bun run test  # integration tests; need Postgres (TEST_DATABASE_URL, or the Docker one)
```

## Pages

- **Inbox** (`/`): packages received over SWORD, with collection, manifest, transfer and metadata details, download, and Accept/Reject buttons (admins) that set the SWORD state. Members see only their own deposits.
- **API keys** (`/api-keys`): everyone can create and revoke keys for depositing as themselves, and see the Service-URL and example requests.
- **Packages** (`/packages`, admins): add files to build a MECA package (or keep an uploaded MECA zip as it is), then tick packages and send them to a destination or one of its collections.
- **Destinations** (`/destinations`, admins): other SWORD servers, added by Service-URL; name, collections and limits come from the service document, and credentials are stored encrypted. This server is always listed, for loopback tests.
- **Outbox** (`/outbox`, admins): what was sent, where, and the last known state; **Refresh** re-reads the remote status document.

## Access

- **People** sign in with Google or GitHub (OAuth). Anyone can sign in; new people are `pending` until an admin sets `User.status` to `active` in the database (Supabase dashboard). Emails in config `admins` are active admins straight away. In development, `auth.devLogin` offers sign-in as any email.
- **Systems** deposit at `/sword/...` with an API key, sent as `Authorization: APIKey <key>` or as the password of HTTP Basic auth. Keys act as their owner: deposits record the owner's email, and stop working if the owner is no longer active or the key is revoked. Only a SHA-256 of each key is stored.

## Configuration

app-config, validated by [`.app-config.schema.yml`](.app-config.schema.yml). Config files are local; only the example is committed:

| File                      | What                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `.app-config.yml.example` | Title, public URL, collections, upload limit, storage (local folder or GCS bucket), sign-in options       |
| `.app-config.yml`         | Your copy of the example, written by `bun run dev` the first time                                         |
| `.app-config.secrets.yml` | Written by `bun run dev`: database URL, session secret, encryption key; optional OAuth clients and admins |

## Data

Postgres (see [`prisma/schema.prisma`](prisma/schema.prisma)): `User`, `ApiKey`, `Deposit` (the sword-server `DepositRecord` as JSON), `Package`, `Destination`, `SentDeposit`. Files go in the blob store under `deposits/<id>/<file>` and `packages/<id>.zip`.

How files are classified when building a package: the XML with an `<article>` root is the JATS `article-metadata` item; files it links to (`xlink:href`) are `article-supporting-file`s; the first PDF (else DOCX, DOC, ODT, TeX, Markdown) is the `manuscript`; everything else is a `manuscript-supporting-file`. Packages built here get a `transfer.xml` written for each destination at send time.

## Deploying

Build the image from the repo root with the [`Dockerfile`](../../Dockerfile) (it serves on `PORT`, default 8080). It needs:

- `APP_CONFIG`: the whole config as JSON, e.g. `APP_CONFIG_ENV=production npx app-config create --secrets --format json` run here with `.app-config.production.yml` and `.app-config.secrets.production.yml`. Use OAuth clients rather than `devLogin`, and `storage.bucket` for Google Cloud Storage (the service account needs object access).
- `PUBLIC_URL` (optional): overrides `publicUrl`. SWORD URLs are absolute, so it must be the URL clients use.
- Postgres: apply migrations with `DIRECT_URL=<url> npx prisma migrate deploy` from this folder before starting a new version.
- Behind a TLS-terminating proxy, the server trusts `X-Forwarded-Proto` (see [`server.js`](server.js)).
