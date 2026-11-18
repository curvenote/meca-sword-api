import { Form, Link } from 'react-router';
import { Pill, when } from '@/components';
import { requireAdmin } from '@/lib/auth.server';
import { db } from '@/lib/db.server';
import { refreshSent } from '@/lib/packages.server';
import type { Route } from './+types/outbox';

export const meta = () => [{ title: 'Outbox' }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const sent = await (await db()).sentDeposit.findMany({ orderBy: { sentAt: 'desc' }, take: 500 });
  return { sent };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireAdmin(request);
  const id = String((await request.formData()).get('refresh') ?? '');
  if (id) await refreshSent(id, user.email);
  return null;
}

export default function Outbox({ loaderData }: Route.ComponentProps) {
  const { sent } = loaderData;
  return (
    <>
      <h2>Sent</h2>
      {sent.length === 0 ? (
        <p className="muted">
          Nothing sent yet. Send packages from <Link to="/packages">Packages</Link>.
        </p>
      ) : (
        <Form method="post">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Destination</th>
                  <th>State</th>
                  <th>Sent</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sent.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.title ?? d.filename}
                      <div className="muted">{d.filename}</div>
                    </td>
                    <td>
                      {d.destination}
                      {d.collection && ` › ${d.collection}`}
                      {d.objectUrl && (
                        <div className="muted">
                          <code>{d.objectUrl}</code>
                        </div>
                      )}
                    </td>
                    <td>
                      {d.error ? (
                        <>
                          <span className="pill error">error</span>
                          <div className="muted">{d.error}</div>
                        </>
                      ) : (
                        <>
                          <Pill state={d.state} />
                          <div className="muted">{d.stateDescription}</div>
                        </>
                      )}
                    </td>
                    <td className="muted">
                      {when(d.sentAt)} by {d.sentBy}
                      {d.checkedAt && (
                        <>
                          <br />
                          checked {when(d.checkedAt)}
                        </>
                      )}
                    </td>
                    <td>
                      {d.objectUrl && (
                        <button type="submit" name="refresh" value={d.id}>
                          Refresh
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
    </>
  );
}
