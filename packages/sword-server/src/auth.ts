import type { Principal } from './types.js';

export type Authenticator = (req: Request) => Principal | null | Promise<Principal | null>;

/** Decode an HTTP Basic Authorization header */
export function parseBasicAuth(
  header: string | null | undefined,
): { username: string; password: string } | null {
  if (!header) return null;
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  let decoded: string;
  try {
    decoded = atob(match[1].trim());
  } catch {
    return null;
  }
  const idx = decoded.indexOf(':');
  if (idx === -1) return null;
  return { username: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * HTTP Basic authentication against a static set of users.
 *
 * Returns `null` when no credentials are supplied (401 AuthenticationRequired) and throws
 * `AuthenticationFailed` for bad credentials (403 AuthenticationFailed).
 */
export function basicAuth(users: Record<string, string>): Authenticator {
  return (req) => {
    const creds = parseBasicAuth(req.headers.get('Authorization'));
    if (!creds) return null;
    const expected = users[creds.username];
    if (expected === undefined || !safeEqual(expected, creds.password)) {
      throw new AuthenticationFailed();
    }
    return { id: creds.username };
  };
}

export class AuthenticationFailed extends Error {
  constructor(message = 'Invalid credentials') {
    super(message);
    this.name = 'AuthenticationFailed';
  }
}

/** Allow every request; useful for local development and tests */
export const anonymous: Authenticator = () => ({ id: 'anonymous' });

/**
 * API key authentication: `Authorization: APIKey <key>` (as named in the SWORD service
 * document's `authentication` list). `keys` maps each key to the principal id it acts as.
 */
export function apiKeyAuth(keys: Record<string, string>): Authenticator {
  return (req) => {
    const match = req.headers.get('Authorization')?.match(/^APIKey\s+(.+)$/i);
    if (!match) return null;
    const key = match[1].trim();
    const id = Object.entries(keys).find(([k]) => safeEqual(k, key))?.[1];
    if (!id) throw new AuthenticationFailed('Invalid API key');
    return { id };
  };
}

/** Try each authenticator in turn; the first to return a principal wins */
export function anyAuth(...authenticators: Authenticator[]): Authenticator {
  return async (req) => {
    for (const authenticate of authenticators) {
      const principal = await authenticate(req);
      if (principal) return principal;
    }
    return null;
  };
}
