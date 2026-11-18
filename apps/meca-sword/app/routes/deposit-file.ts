import { zipResponse } from '@/lib/responses.server';
import { getSword } from '@/lib/sword.server';
import { findDeposit } from '@/lib/deposits.server';
import type { Route } from './+types/deposit-file';

export async function loader({ request, params }: Route.LoaderArgs) {
  const { record } = await findDeposit(request, params.id);
  const data = await (await getSword()).store.getFile(record.id, params.name);
  if (!data) throw new Response('Not found', { status: 404 });
  return zipResponse(data, params.name);
}
