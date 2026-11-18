import { requireUser } from './auth.server';
import { getSword } from './sword.server';

/** A deposit, if this user may see it: admins see everything, others their own */
export async function findDeposit(request: Request, id: string) {
  const user = await requireUser(request);
  const record = await (await getSword()).store.get(id);
  if (!record || (user.role !== 'admin' && record.depositedBy !== user.email)) {
    throw new Response('Not found', { status: 404 });
  }
  return { user, record };
}
