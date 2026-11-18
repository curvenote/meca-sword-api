import { Link } from 'react-router';
import { ManifestTable } from '@/components';
import { requireAdmin } from '@/lib/auth.server';
import { inspectPackage, readPackage } from '@/lib/packages.server';
import type { Route } from './+types/package';

export const meta = ({ data }: Route.MetaArgs) => [{ title: data?.pkg.title ?? 'Package' }];

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request);
  const found = await readPackage(params.id);
  if (!found) throw new Response('Not found', { status: 404 });
  const { manifest, errors, warnings } = inspectPackage(found.data);
  return { pkg: found.pkg, inspection: { manifest, errors, warnings } };
}

export default function PackageDetail({ loaderData }: Route.ComponentProps) {
  const { pkg, inspection } = loaderData;
  return (
    <>
      <p>
        <Link to="/packages">&larr; Packages</Link>
      </p>
      <h2>{pkg.title ?? pkg.filename}</h2>
      <p className="muted">
        {pkg.authors}
        {pkg.doi && ` · doi:${pkg.doi}`}
      </p>
      <p>
        <a href={`/packages/${pkg.id}/download`} download>
          Download {pkg.filename}
        </a>
      </p>
      {pkg.notes.length > 0 && (
        <>
          <h3>How it was built</h3>
          <ul className="compact">
            {pkg.notes.map((n) => (
              <li key={n} className="muted">
                {n}
              </li>
            ))}
          </ul>
        </>
      )}
      {pkg.built && (
        <p className="muted">transfer.xml is written for each destination when it's sent.</p>
      )}
      <h3>MECA manifest</h3>
      <ManifestTable meca={inspection} />
    </>
  );
}
