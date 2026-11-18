import type { Config } from '@react-router/dev/config';

export default {
  ssr: true,
  // Opt in to React Router v8 behaviour now (also quiets the dev server's warnings)
  future: {
    v8_middleware: true,
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true,
  },
} satisfies Config;
