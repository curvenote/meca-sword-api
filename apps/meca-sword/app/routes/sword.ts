import { getSword } from '@/lib/sword.server';
import type { Route } from './+types/sword';

/** Every SWORD request goes to the SWORD server, which authenticates it with API keys */
const handle = async ({ request }: { request: Request }) => (await getSword()).handle(request);

export const loader = (args: Route.LoaderArgs) => handle(args);
export const action = (args: Route.ActionArgs) => handle(args);
