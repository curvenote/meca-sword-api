# @curvenote/sword-server

A SWORD v3 server for receiving MECA packages. It is a plain fetch handler, `(Request) => Promise<Response>`, so it mounts in Bun, Node (via `@hono/node-server`), Hono, React Router / Remix resource routes, Next.js route handlers, Cloudflare Workers, etc.

```ts
import { SwordServer, FileSystemStore, basicAuth } from '@curvenote/sword-server';

const sword = new SwordServer({
  baseUrl: 'https://journal.example.org/sword', // where the handler is mounted
  store: new FileSystemStore('./data/inbox'), // or new MemoryStore()
  authenticate: basicAuth({ journal: process.env.SWORD_PASSWORD! }),
  title: 'Example Journal',
  onDeposit: (record) => console.log('received', record.id, record.metadata['dc:title']),
});

// e.g. Bun
Bun.serve({ fetch: sword.handle });
```

Endpoints, relative to `baseUrl`:

| Path                       | Methods         |                                  |
| -------------------------- | --------------- | -------------------------------- |
| `/service-document`        | `GET`, `POST`   | Service document; create deposit |
| `/objects/:id`             | `GET`, `DELETE` | Status document; delete          |
| `/objects/:id/metadata`    | `GET`, `PUT`    | SWORD metadata document          |
| `/objects/:id/files/:name` | `GET`           | Original MECA zip                |

Collections: pass `collections: [{ id: 'articles', title: 'Articles' }]` to expose each at `/collections/:id` (listed under `services` in the root service document); deposits record their `collection`.

Options: `maxUploadSize` (default 1 GiB), `requireDigest` (default `true`), `rejectInvalidMeca` (default `true`), `initialState` (default `inWorkflow`), `inspect` (custom MECA validation), `onDeposit`.

`authenticate` receives the `Request` and returns a principal `{ id }`, returns `null` for missing credentials (401), or throws `AuthenticationFailed` (403), so other schemes can replace Basic auth. `apiKeyAuth({ key: 'principal' })` handles `Authorization: APIKey <key>`, and `anyAuth(basicAuth(...), apiKeyAuth(...))` accepts either.

Use `server.setState(id, State.Ingested | State.Rejected, description)` to report the outcome of your workflow back to the depositor. Implement `SwordStore` to keep deposits in a database or object storage.
