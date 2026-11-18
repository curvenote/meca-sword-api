import { Form } from 'react-router';
import { Messages, when } from '@/components';
import { requireAdmin } from '@/lib/auth.server';
import {
  deleteDestination,
  describe,
  listDestinations,
  refreshDestination,
  saveDestination,
} from '@/lib/destinations.server';
import { getSword } from '@/lib/sword.server';
import type { Route } from './+types/destinations';

export const meta = () => [{ title: 'Destinations' }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return { destinations: await listDestinations(), selfUrl: (await getSword()).serviceUrl };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const value = (k: string) => String(form.get(k) ?? '').trim() || undefined;
  if (form.has('refresh')) {
    await refreshDestination(String(form.get('refresh')));
    return null;
  }
  if (form.has('delete')) {
    await deleteDestination(String(form.get('delete')));
    return null;
  }
  const serviceUrl = value('serviceUrl');
  if (!serviceUrl || !/^https?:\/\/.+/.test(serviceUrl)) return { error: 'Enter a Service-URL' };
  try {
    const dest = await saveDestination(serviceUrl, {
      username: value('username'),
      password: value('password'),
      apiKey: value('apiKey'),
    });
    return dest.error
      ? { error: `Saved ${serviceUrl}, but couldn't read its service document: ${dest.error}` }
      : { notice: `Saved ${dest.name}` };
  } catch (error) {
    return { error: describe(error) };
  }
}

export default function Destinations({ loaderData, actionData }: Route.ComponentProps) {
  const { destinations, selfUrl } = loaderData;
  return (
    <>
      <Messages {...(actionData ?? {})} />
      <h2>Destinations</h2>
      <Form method="post">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Collections</th>
                <th>Credentials</th>
                <th>Checked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {destinations.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.name}
                    <div className="muted">
                      <code>{d.serviceUrl}</code>
                    </div>
                    {d.error && (
                      <div>
                        <span className="pill error">problem</span>{' '}
                        <span className="muted">{d.error}</span>
                      </div>
                    )}
                  </td>
                  <td className="muted">
                    {d.collections.map((c) => c.title).join(', ') || 'none'}
                  </td>
                  <td className="muted">
                    {d.builtIn ? 'your account' : (d.credentials ?? 'none')}
                  </td>
                  <td className="muted">{when(d.checkedAt)}</td>
                  <td>
                    {d.builtIn ? (
                      <span className="muted">built in</span>
                    ) : (
                      <>
                        <button type="submit" name="refresh" value={d.id}>
                          Refresh
                        </button>{' '}
                        <button type="submit" name="delete" value={d.id}>
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Form>
      <h2>Add a destination</h2>
      <Form method="post">
        <fieldset>
          <label htmlFor="serviceUrl">Service-URL</label>
          <input id="serviceUrl" name="serviceUrl" type="url" required placeholder={selfUrl} />
          <p className="muted">
            The name, collections and upload limits are read from its service document. Saving the
            same Service-URL again updates it.
          </p>
          <div className="row">
            <div>
              <label htmlFor="username">Username</label>
              <input id="username" name="username" type="text" autoComplete="off" />
            </div>
            <div>
              <label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="off" />
            </div>
            <div>
              <label htmlFor="apiKey">or API key</label>
              <input id="apiKey" name="apiKey" type="password" autoComplete="off" />
            </div>
          </div>
          <p className="muted">
            Credentials are stored encrypted. Leave them blank to keep the saved ones.
          </p>
          <button className="primary" type="submit">
            Save destination
          </button>
        </fieldset>
      </Form>
    </>
  );
}
