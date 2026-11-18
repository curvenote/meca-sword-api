import { requireAdmin } from '@/lib/auth.server';
import { readPackage } from '@/lib/packages.server';
import { zipResponse } from '@/lib/responses.server';
import type { Route } from './+types/package-download';

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request);
  const found = await readPackage(params.id);
  if (!found) throw new Response('Not found', { status: 404 });
  return zipResponse(found.data, found.pkg.filename);
}
