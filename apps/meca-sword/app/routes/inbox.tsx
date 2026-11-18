import { Link } from 'react-router';
import type { DepositRecord } from '@curvenote/sword-server';
import { Pill, when } from '@/components';
import { requireUser } from '@/lib/auth.server';
import { getConfig } from '@/lib/config.server';
import { db } from '@/lib/db.server';
import { getSword } from '@/lib/sword.server';
import type { Route } from './+types/inbox';

export const meta = () => [{ title: 'Inbox' }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const isAdmin = user.role === 'admin';
  const [config, sword] = await Promise.all([getConfig(), getSword()]);
  const rows = await (
    await db()
  ).deposit.findMany({
    where: isAdmin ? {} : { depositedBy: user.email },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const collections = Object.fromEntries((config.collections ?? []).map((c) => [c.id, c.title]));
  return {
    isAdmin,
    serviceUrl: sword.serviceUrl,
    deposits: rows.map((row) => {
      const record = row.record as unknown as DepositRecord;
      return {
        id: row.id,
        title: row.title ?? record.files[0]?.name ?? row.id,
        creators: record.metadata['dc:creator'],
        from: record.meca?.transfer?.source?.provider?.name ?? row.depositedBy ?? '',
        collection: row.collection ? (collections[row.collection] ?? row.collection) : '',
        state: row.state,
        createdAt: row.createdAt,
      };
    }),
  };
}

export default function Inbox({ loaderData }: Route.ComponentProps) {
  const { deposits, serviceUrl, isAdmin } = loaderData;
  return (
    <>
      <div className="panel">
        SWORD Service-URL: <code>{serviceUrl}</code>
        <div className="muted">
          Deposit with an API key from <Link to="/api-keys">API keys</Link>.
        </div>
      </div>
      <h2>{isAdmin ? 'Received' : 'Your deposits'}</h2>
      {deposits.length === 0 ? (
        <p className="muted">
          Nothing received yet.{' '}
          {isAdmin ? (
            <>
              Send yourself a package from <Link to="/packages">Packages</Link>.
            </>
          ) : (
            'Deposit a MECA package at the Service-URL above.'
          )}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Article</th>
                <th>From</th>
                <th>Collection</th>
                <th>State</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link to={`/inbox/${d.id}`}>{d.title}</Link>
                    {d.creators && <div className="muted">{String(d.creators)}</div>}
                  </td>
                  <td>{d.from}</td>
                  <td>{d.collection}</td>
                  <td>
                    <Pill state={d.state} />
                  </td>
                  <td className="muted">{when(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
