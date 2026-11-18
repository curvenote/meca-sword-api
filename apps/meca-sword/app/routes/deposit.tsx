import { Form, Link, redirect } from 'react-router';
import { State } from '@curvenote/sword-common';
import type { StateURI } from '@curvenote/sword-common';
import type { DepositRecord } from '@curvenote/sword-server';
import { ManifestTable, Pill, size, when } from '@/components';
import { requireAdmin } from '@/lib/auth.server';
import { findDeposit } from '@/lib/deposits.server';
import { getConfig } from '@/lib/config.server';
import { getSword } from '@/lib/sword.server';
import type { Route } from './+types/deposit';

export const meta = ({ data }: Route.MetaArgs) => [{ title: data?.title ?? 'Deposit' }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, record } = await findDeposit(request, params.id);
  const [config, sword] = await Promise.all([getConfig(), getSword()]);
  return {
    record: record as DepositRecord,
    title: String(record.metadata['dc:title'] ?? record.id),
    objectUrl: sword.objectUrl(record.id),
    collection: config.collections?.find((c) => c.id === record.collection)?.title,
    isAdmin: user.role === 'admin',
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireAdmin(request);
  const state = String((await request.formData()).get('state')) as StateURI;
  if (!(Object.values(State) as string[]).includes(state)) {
    throw new Response('Unknown state', { status: 400 });
  }
  const descriptions: Record<string, string> = {
    [State.Ingested]: `Accepted by ${user.name ?? user.email}`,
    [State.Rejected]: 'Rejected',
  };
  await (await getSword()).setState(params.id, state, descriptions[state]);
  return redirect(`/inbox/${params.id}`);
}

export default function Deposit({ loaderData }: Route.ComponentProps) {
  const { record, title, objectUrl, collection, isAdmin } = loaderData;
  const meca = record.meca;
  const metadata = Object.entries(record.metadata).filter(([k]) => !k.startsWith('@'));
  return (
    <>
      <p>
        <Link to="/">&larr; Inbox</Link>
      </p>
      <h2>{title}</h2>
      <p>
        <Pill state={record.state} /> <span className="muted">{record.stateDescription}</span>
      </p>
      {isAdmin && (
        <p>
          <Form method="post" className="inline">
            <input type="hidden" name="state" value={State.Ingested} />
            <button className="primary" type="submit">
              Accept (ingest)
            </button>
          </Form>{' '}
          <Form method="post" className="inline">
            <input type="hidden" name="state" value={State.Rejected} />
            <button type="submit">Reject</button>
          </Form>
        </p>
      )}
      <div className="panel">
        Object-URL: <code>{objectUrl}</code>
        <br />
        Deposited by <strong>{record.depositedBy ?? 'unknown'}</strong>
        {collection && (
          <>
            {' '}
            into <strong>{collection}</strong>
          </>
        )}{' '}
        on {when(record.createdAt)}
      </div>
      <h3>Files</h3>
      <ul>
        {record.files.map((f) => (
          <li key={f.name}>
            <a href={`/inbox/${record.id}/files/${encodeURIComponent(f.name)}`} download>
              {f.name}
            </a>{' '}
            <span className="muted">
              {size(f.size)} · SHA-256 {f.sha256}
            </span>
          </li>
        ))}
      </ul>
      <h3>Metadata</h3>
      <div className="table-wrap">
        <table>
          <tbody>
            {metadata.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{typeof v === 'string' ? v : JSON.stringify(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meca && (
        <>
          <h3>MECA manifest</h3>
          <ManifestTable meca={meca} />
          {meca.transfer && (
            <>
              <h3>Transfer</h3>
              <p>
                From <strong>{meca.transfer.source?.provider?.name ?? 'unknown'}</strong> to{' '}
                <strong>{meca.transfer.destination?.provider?.name ?? 'unknown'}</strong>
                {meca.transfer.destination?.publication?.title &&
                  ` (${meca.transfer.destination.publication.title})`}
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}
