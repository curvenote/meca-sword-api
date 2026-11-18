import { State } from '@curvenote/sword-common';
import type { MecaInspection } from '@curvenote/sword-common/meca';

const STATE_LABELS: Record<string, string> = {
  [State.Accepted]: 'accepted',
  [State.InProgress]: 'in progress',
  [State.InWorkflow]: 'in workflow',
  [State.Ingested]: 'ingested',
  [State.Rejected]: 'rejected',
  [State.Deleted]: 'deleted',
};

export const stateLabel = (uri?: string | null) => (uri ? (STATE_LABELS[uri] ?? uri) : 'unknown');

const PILL_CLASS: Record<string, string> = {
  ingested: 'ingested',
  rejected: 'rejected',
  'in workflow': 'workflow',
};

export function Pill({ state }: { state?: string | null }) {
  const label = stateLabel(state);
  return <span className={`pill ${PILL_CLASS[label] ?? ''}`}>{label}</span>;
}

export function Messages({
  error,
  log,
  notice,
}: {
  error?: string;
  log?: string;
  notice?: string;
}) {
  return (
    <>
      {error && (
        <div className="panel error-box">
          <strong>{error}</strong>
          {log && <pre className="muted">{log}</pre>}
        </div>
      )}
      {notice && <div className="panel notice">{notice}</div>}
    </>
  );
}

export const size = (bytes: number) =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;

/** Same on the server and in the browser, so hydration matches */
export const when = (date?: string | Date | null) =>
  date ? `${new Date(date).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '';

export function ManifestTable({
  meca,
}: {
  meca: Pick<MecaInspection, 'manifest' | 'errors' | 'warnings'>;
}) {
  return (
    <>
      {meca.errors.length > 0 && (
        <div className="panel error-box">
          {meca.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      {meca.warnings.length > 0 && (
        <div className="panel">
          {meca.warnings.map((e) => (
            <div key={e} className="muted">
              {e}
            </div>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th>Media type</th>
            </tr>
          </thead>
          <tbody>
            {(meca.manifest ?? []).map((i) => (
              <tr key={i.href}>
                <td>
                  <code>{i.href}</code>
                </td>
                <td>{i.itemType ?? ''}</td>
                <td>{i.mediaType ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
