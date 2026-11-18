import { redirect } from 'react-router';
import { authenticate, signIn } from '@/lib/auth.server';
import type { Route } from './+types/auth-callback';

/** The provider sends people back here */
export async function loader({ request, params }: Route.LoaderArgs) {
  let profile;
  try {
    profile = await authenticate(params.provider, request);
  } catch (error) {
    if (error instanceof Response) throw error;
    const message = error instanceof Error ? error.message : 'Sign-in failed';
    console.warn(`Sign-in with ${params.provider} failed: ${message}`);
    return redirect(`/login?error=${encodeURIComponent(message)}`);
  }
  return signIn(request, profile);
}
