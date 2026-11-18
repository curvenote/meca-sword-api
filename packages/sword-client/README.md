# @curvenote/sword-client

A SWORD v3 client for depositing MECA packages. Uses `fetch` and WebCrypto only, so it runs in Node 20+, Bun and browsers.

```ts
import { SwordClient, State } from '@curvenote/sword-client';

const client = new SwordClient({
  serviceUrl: 'https://journal.example.org/sword/service-document',
  username: 'curvenote',
  password: process.env.SWORD_PASSWORD,
});

const { location, status } = await client.depositMeca(zipBytes, { filename: 'abc-meca.zip' });
const final = await client.waitForState(location, [State.Ingested, State.Rejected]);
```

`depositMeca` reads the service document first, checks `acceptDeposits` and `maxUploadSize`, picks the MECA packaging URI if offered (otherwise Binary), and sends `Content-Disposition`, `Digest: SHA-256=…` and `Packaging`.

Pass `apiKey` instead of `username`/`password` to send `Authorization: APIKey <key>`. Use `getCollections()` to list a server's collections and `depositMeca(data, { collection: url })` to deposit into one.

Other methods: `getServiceDocument`, `depositMetadata`, `getStatus`, `getMetadata`, `replaceMetadata` (with `ifMatch`), `downloadFile`, `downloadOriginalDeposit`, `deleteObject`, `waitForState`. Failed requests throw a `SwordError` carrying the server's error `type`, HTTP `status` and `log`.
