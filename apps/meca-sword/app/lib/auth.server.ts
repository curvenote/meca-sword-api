import { createCookieSessionStorage, redirect } from 'react-router';
import { Authenticator } from 'remix-auth';
import { OAuth2Strategy } from 'remix-auth-oauth2';
import type { User } from '@/generated/prisma/client';
import { getConfig, isProduction } from './config.server';
import type { AppConfig } from './config.server';
import { db } from './db.server';

export type Profile = { email: string; name?: string; provider: string };

export const PROVIDERS = {
  google: 'Google',
  github: 'GitHub',
} as const;
export type Provider = keyof typeof PROVIDERS;

type SessionData = { email: string };

let sessions: Promise<ReturnType<typeof createCookieSessionStorage<SessionData>>> | undefined;

function sessionStorage() {
  sessions ??= getConfig().then((config) =>
    createCookieSessionStorage<SessionData>({
      cookie: {
        name: 'meca_session',
        httpOnly: true,
        sameSite: 'lax',
        secure: config.publicUrl.startsWith('https:'),
        path: '/',
        maxAge: 30 * 24 * 3600,
        secrets: [config.session.secret],
      },
    }),
  );
  return sessions;
}

function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

function googleStrategy(config: AppConfig) {
  const client = config.auth?.google;
  if (!client) return undefined;
  return new OAuth2Strategy<Profile>(
    {
      cookie: 'oauth_google',
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      redirectURI: `${config.publicUrl}/auth/google/callback`,
      scopes: ['openid', 'email', 'profile'],
    },
    async ({ tokens }) => {
      // The ID token comes straight from Google's token endpoint over TLS, so its claims
      // can be read without checking the signature (OpenID Connect Core 3.1.3.7)
      const claims = decodeJwt(tokens.idToken());
      if (typeof claims.email !== 'string' || claims.email_verified !== true) {
        throw new Error('Your Google account has no verified email address');
      }
      const name = typeof claims.name === 'string' ? claims.name : undefined;
      return { email: claims.email, name, provider: 'google' };
    },
  );
}

function githubStrategy(config: AppConfig) {
  const client = config.auth?.github;
  if (!client) return undefined;
  return new OAuth2Strategy<Profile>(
    {
      cookie: 'oauth_github',
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      authorizationEndpoint: 'https://github.com/login/oauth/authorize',
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      redirectURI: `${config.publicUrl}/auth/github/callback`,
      scopes: ['read:user', 'user:email'],
    },
    async ({ tokens }) => {
      const headers = {
        Authorization: `Bearer ${tokens.accessToken()}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'meca-sword',
      };
      const [user, emails] = await Promise.all([
        fetch('https://api.github.com/user', { headers }).then((r) => r.json()),
        fetch('https://api.github.com/user/emails', { headers }).then((r) => r.json()),
      ]);
      const email = (emails as { email: string; primary: boolean; verified: boolean }[]).find(
        (e) => e.primary && e.verified,
      )?.email;
      if (!email) throw new Error('Your GitHub account has no verified primary email address');
      return { email, name: user.name || user.login, provider: 'github' };
    },
  );
}

let authenticator: Promise<Authenticator<Profile>> | undefined;

function getAuthenticator() {
  authenticator ??= getConfig().then((config) => {
    const auth = new Authenticator<Profile>();
    const google = googleStrategy(config);
    const github = githubStrategy(config);
    if (google) auth.use(google, 'google');
    if (github) auth.use(github, 'github');
    return auth;
  });
  return authenticator;
}

/** The sign-in options to show */
export async function signInOptions() {
  const config = await getConfig();
  return {
    providers: (Object.keys(PROVIDERS) as Provider[])
      .filter((p) => config.auth?.[p])
      .map((p) => ({ id: p, name: PROVIDERS[p] })),
    devLogin: devLoginEnabled(config),
  };
}

export function devLoginEnabled(config: AppConfig) {
  return !!config.auth?.devLogin && !isProduction();
}

/** Start or finish an OAuth sign-in; throws the redirect to the provider on the way out */
export async function authenticate(provider: string, request: Request): Promise<Profile> {
  if (!(provider in PROVIDERS)) throw new Response('Unknown sign-in provider', { status: 404 });
  return (await getAuthenticator()).authenticate(provider, request);
}

/**
 * Record a sign-in and start a session. New people are `pending` until an admin makes them
 * `active`; emails listed as admins in config are active admins straight away.
 */
export async function signIn(request: Request, profile: Profile) {
  const config = await getConfig();
  const email = profile.email.toLowerCase();
  const isAdmin = (config.admins ?? []).some((a) => a.toLowerCase() === email);
  const now = new Date();
  await (
    await db()
  ).user.upsert({
    where: { email },
    create: {
      email,
      name: profile.name,
      provider: profile.provider,
      lastSeenAt: now,
      ...(isAdmin ? { status: 'active', role: 'admin' } : {}),
    },
    update: {
      name: profile.name,
      provider: profile.provider,
      lastSeenAt: now,
      ...(isAdmin ? { status: 'active', role: 'admin' } : {}),
    },
  });
  const storage = await sessionStorage();
  const session = await storage.getSession(request.headers.get('Cookie'));
  session.set('email', email);
  return redirect('/', { headers: { 'Set-Cookie': await storage.commitSession(session) } });
}

export async function signOut(request: Request) {
  const storage = await sessionStorage();
  const session = await storage.getSession(request.headers.get('Cookie'));
  return redirect('/login', { headers: { 'Set-Cookie': await storage.destroySession(session) } });
}

/** The signed-in user, whatever their status, or undefined */
export async function currentUser(request: Request): Promise<User | undefined> {
  const storage = await sessionStorage();
  const session = await storage.getSession(request.headers.get('Cookie'));
  const email = session.get('email');
  if (typeof email !== 'string') return undefined;
  return (await (await db()).user.findUnique({ where: { email } })) ?? undefined;
}

/** Form posts must come from this site (the session cookie is also SameSite=Lax) */
function checkOrigin(request: Request) {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    throw new Response('Cross-origin form posts are not allowed', { status: 403 });
  }
}

/** An active user, or a redirect to the sign-in page */
export async function requireUser(request: Request): Promise<User> {
  checkOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'active') throw redirect('/login');
  if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 3600_000) {
    await (
      await db()
    ).user.update({ where: { email: user.email }, data: { lastSeenAt: new Date() } });
  }
  return user;
}

export async function requireAdmin(request: Request): Promise<User> {
  const user = await requireUser(request);
  if (user.role !== 'admin') throw new Response('Only admins can do that', { status: 403 });
  return user;
}
