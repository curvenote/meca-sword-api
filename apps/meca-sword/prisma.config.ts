import { defineConfig } from 'prisma/config';

/**
 * Prisma's CLI (generate, migrate). Migrations use `DIRECT_URL` (a direct or session-mode
 * connection, e.g. Supabase's port 5432); `scripts/dev.ts` sets it from app-config, and a
 * deployment sets it itself. The app connects with `database.url` from app-config
 * (`app/lib/db.server.ts`).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:54329/meca_sword',
  },
});
