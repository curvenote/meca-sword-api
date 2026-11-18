import { Form, Link, redirect } from 'react-router';
import { Messages, size, when } from '@/components';
import { requireAdmin } from '@/lib/auth.server';
import { db } from '@/lib/db.server';
import { describe, listDestinations } from '@/lib/destinations.server';
import { addPackage, deletePackage, sendPackages } from '@/lib/packages.server';
import type { Route } from './+types/packages';

export const meta = () => [{ title: 'Packages' }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const packages = await (await db()).package.findMany({ orderBy: { createdAt: 'desc' } });
  return { packages, destinations: await listDestinations() };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireAdmin(request);
  const form = await request.formData();
  if (form.has('delete')) {
    await deletePackage(String(form.get('delete')));
    return redirect('/packages');
  }
  const intent = String(form.get('intent'));
  if (intent === 'add') {
    const uploads = [...form.getAll('files'), ...form.getAll('folder')].filter(
      (f): f is File => f instanceof File && f.size > 0,
    );
    if (uploads.length === 0) return { error: 'Choose some files to add' };
    const result = await addPackage(uploads, user.email);
    if ('error' in result) return result;
    return redirect(`/packages/${result.id}`);
  }
  if (intent === 'send') {
    const ids = form.getAll('packages').map(String).filter(Boolean);
    const [destinationId, collectionUrl] = String(form.get('target') ?? '').split('::');
    if (ids.length === 0) return { error: 'Select at least one package' };
    try {
      await sendPackages(ids, destinationId, collectionUrl || undefined, user.email);
    } catch (error) {
      return { error: describe(error) };
    }
    return redirect('/outbox');
  }
  throw new Response('Unknown action', { status: 400 });
}

export default function Packages({ loaderData, actionData }: Route.ComponentProps) {
  const { packages, destinations } = loaderData;
  return (
    <>
      <Messages {...actionData} />
      <h2>Add a package</h2>
      <Form method="post" encType="multipart/form-data">
        <input type="hidden" name="intent" value="add" />
        <div className="drop">
          <div className="row">
            <div>
              <label htmlFor="files">Files</label>
              <input id="files" name="files" type="file" multiple />
            </div>
            <div>
              <label htmlFor="folder">or a folder</label>
              <input id="folder" name="folder" type="file" multiple {...{ webkitdirectory: '' }} />
            </div>
          </div>
          <p className="muted">
            Choose the JATS article XML with its PDF, figures and data, a zip of them, or a
            ready-made MECA zip. Title, authors and file roles are read from the files.
          </p>
          <button className="primary" type="submit">
            Add package
          </button>
        </div>
      </Form>

      <h2>Packages</h2>
      {packages.length === 0 ? (
        <p className="muted">No packages yet.</p>
      ) : (
        <Form method="post">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Article</th>
                  <th>Contents</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id}>
                    <td className="check">
                      <input
                        type="checkbox"
                        name="packages"
                        value={p.id}
                        aria-label={`Select ${p.title ?? p.filename}`}
                      />
                    </td>
                    <td>
                      <Link to={`/packages/${p.id}`}>{p.title ?? p.filename}</Link>
                      <div className="muted">{p.authors}</div>
                    </td>
                    <td className="muted">
                      {p.fileCount} files · {size(p.size)}
                      {p.built && ' · built here'}
                      {p.warnings.length > 0 && <div>{p.warnings.length} warning(s)</div>}
                    </td>
                    <td className="muted">{when(p.createdAt)}</td>
                    <td>
                      <a href={`/packages/${p.id}/download`} download>
                        Download
                      </a>{' '}
                      <button type="submit" name="delete" value={p.id}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <fieldset>
            <label htmlFor="target">Send selected to</label>
            <select id="target" name="target">
              {destinations.map((d) => (
                <optgroup key={d.id} label={d.name}>
                  <option value={`${d.id}::`}>{d.name}</option>
                  {d.collections.map((c) => (
                    <option key={c.url} value={`${d.id}::${c.url}`}>
                      {d.name} › {c.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="muted">
              <Link to="/destinations">Add or manage destinations</Link>
            </p>
            <button className="primary" type="submit" name="intent" value="send">
              Send
            </button>
          </fieldset>
        </Form>
      )}
    </>
  );
}
