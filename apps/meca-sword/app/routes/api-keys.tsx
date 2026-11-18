import { Form } from 'react-router';
import { Messages, when } from '@/components';
import { createApiKey } from '@/lib/api-keys.server';
import { requireUser } from '@/lib/auth.server';
import { db } from '@/lib/db.server';
import { getSword } from '@/lib/sword.server';
import type { Route } from './+types/api-keys';

export const meta = () => [{ title: 'API keys' }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const sword = await getSword();
  const keys = await (
    await db()
  ).apiKey.findMany({
    where: { ownerEmail: user.email },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
  return {
    keys,
    serviceUrl: sword.serviceUrl,
    collections: sword.collections.map((c) => ({ title: c.title, url: sword.collectionUrl(c.id) })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  if (form.has('revoke')) {
    await (
      await db()
    ).apiKey.updateMany({
      where: { id: String(form.get('revoke')), ownerEmail: user.email, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { notice: 'Key revoked' };
  }
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { error: 'Give the key a name, such as the system that will use it' };
  const { key } = await createApiKey(user.email, name);
  return { key, name };
}

export default function ApiKeys({ loaderData, actionData }: Route.ComponentProps) {
  const { keys, serviceUrl, collections } = loaderData;
  const created = actionData && 'key' in actionData ? actionData : undefined;
  const messages = actionData && !('key' in actionData) ? actionData : {};
  const example = created?.key ?? '<your key>';
  return (
    <>
      <Messages {...messages} />
      {created && (
        <div className="panel notice">
          <strong>Your new key “{created.name}”</strong>
          <pre>{created.key}</pre>
          <div className="muted">Copy it now; it won't be shown again.</div>
        </div>
      )}
      <h2>API keys</h2>
      <p className="muted">
        Keys let a system deposit MECA packages here over SWORD as you. Deposits made with your keys
        show up in your inbox.
      </p>
      {keys.length > 0 && (
        <Form method="post">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td>
                      <code>{k.prefix}…</code>
                    </td>
                    <td className="muted">{when(k.createdAt)}</td>
                    <td className="muted">{k.lastUsedAt ? when(k.lastUsedAt) : 'never'}</td>
                    <td>
                      {k.revokedAt ? (
                        <span className="muted">revoked {when(k.revokedAt)}</span>
                      ) : (
                        <button type="submit" name="revoke" value={k.id}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Form>
      )}
      <Form method="post">
        <fieldset>
          <label htmlFor="name">New key</label>
          <input id="name" name="name" type="text" placeholder="e.g. OJS test server" required />
          <p>
            <button className="primary" type="submit">
              Create key
            </button>
          </p>
        </fieldset>
      </Form>

      <h2>Depositing</h2>
      <p>
        Service-URL: <code>{serviceUrl}</code>
      </p>
      {collections.length > 0 && (
        <ul className="compact">
          {collections.map((c) => (
            <li key={c.url}>
              {c.title}: <code>{c.url}</code>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">
        Send the key as <code>Authorization: APIKey &lt;key&gt;</code>, or as the password of HTTP
        Basic auth (any username). Deposits must include a <code>Digest: SHA-256=…</code> header.
      </p>
      <pre>{`curl -H "Authorization: APIKey ${example}" ${serviceUrl}

curl -X POST ${serviceUrl} \\
  -H "Authorization: APIKey ${example}" \\
  -H "Content-Type: application/zip" \\
  -H "Content-Disposition: attachment; filename=paper-meca.zip" \\
  -H "Packaging: https://meca.zip/sword/package/MECA" \\
  -H "Digest: SHA-256=$(openssl dgst -sha256 -binary paper-meca.zip | base64)" \\
  --data-binary @paper-meca.zip`}</pre>
    </>
  );
}
