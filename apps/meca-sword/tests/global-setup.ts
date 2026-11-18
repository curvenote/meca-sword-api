import { execSync } from 'node:child_process';

/**
 * Integration tests need Postgres: `TEST_DATABASE_URL`, or `meca_sword_test` in the local
 * Docker database. Migrations are applied without resetting; each run uses its own emails.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/meca_sword_test';

export default function setup() {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DIRECT_URL: TEST_DATABASE_URL },
  });
}
