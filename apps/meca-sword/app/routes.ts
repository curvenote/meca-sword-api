import { index, layout, route } from '@react-router/dev/routes';
import type { RouteConfig } from '@react-router/dev/routes';

export default [
  // SWORD v3: every method, authenticated with API keys by the SWORD server itself
  route('sword/*', 'routes/sword.ts'),
  route('healthz', 'routes/healthz.ts'),
  route('login', 'routes/login.tsx'),
  route('logout', 'routes/logout.ts'),
  route('auth/:provider', 'routes/auth.ts'),
  route('auth/:provider/callback', 'routes/auth-callback.ts'),
  layout('routes/layout.tsx', [
    index('routes/inbox.tsx'),
    route('inbox/:id', 'routes/deposit.tsx'),
    route('inbox/:id/files/:name', 'routes/deposit-file.ts'),
    route('packages', 'routes/packages.tsx'),
    route('packages/:id', 'routes/package.tsx'),
    route('packages/:id/download', 'routes/package-download.ts'),
    route('destinations', 'routes/destinations.tsx'),
    route('outbox', 'routes/outbox.tsx'),
    route('api-keys', 'routes/api-keys.tsx'),
  ]),
] satisfies RouteConfig;
