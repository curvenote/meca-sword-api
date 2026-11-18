import { authenticate } from '@/lib/auth.server';
import type { Route } from './+types/auth';

/** Start a sign-in: redirects to the provider */
export async function loader({ request, params }: Route.LoaderArgs) {
  await authenticate(params.provider, request);
  return null;
}
