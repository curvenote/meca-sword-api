/**
 * Local development: `bun run dev` (from the repo root, alongside the library watchers).
 *
 * Writes `.app-config.yml` (from the example) and `.app-config.secrets.yml` (local database,
 * random secrets) the first time, starts Postgres in Docker, applies migrations and runs the
 * React Router dev server.
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const CONFIG = '.app-config.yml';
const SECRETS = '.app-config.secrets.yml';
const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54329/meca_sword';

if (!fs.existsSync(CONFIG)) {
  fs.copyFileSync(`${CONFIG}.example`, CONFIG);
  console.log(`Wrote ${CONFIG} from ${CONFIG}.example`);
}

if (!fs.existsSync(SECRETS)) {
  const random = () => crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(
    SECRETS,
    `# Local development secrets (not committed)
database:
  url: ${LOCAL_DB}
session:
  secret: ${random()}
encryptionKey: ${random()}
# Admins are active as soon as they sign in
# admins: [you@example.org]
# To try real sign-in locally, add OAuth clients with redirect URIs
# http://localhost:5173/auth/google/callback and http://localhost:5173/auth/github/callback
# auth:
#   devLogin: true
#   google: { clientId: ..., clientSecret: ... }
#   github: { clientId: ..., clientSecret: ... }
`,
  );
  console.log(`Wrote ${SECRETS}`);
}

const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } }).status === 0;

if (!run('docker', ['compose', 'up', '-d', '--wait', 'db'])) {
  console.warn('Could not start Postgres with Docker; using whatever is at database.url');
}
const dbUrl = spawnSync(
  'npx',
  ['app-config', 'create', '--secrets', '--select', '#/database/url', '--format', 'raw'],
  {
    encoding: 'utf8',
  },
).stdout.trim();
if (!run('npx', ['prisma', 'migrate', 'deploy'], { DIRECT_URL: dbUrl || LOCAL_DB })) {
  process.exit(1);
}
spawn('npx', ['react-router', 'dev'], { stdio: 'inherit' }).on('exit', (code) =>
  process.exit(code ?? 0),
);
