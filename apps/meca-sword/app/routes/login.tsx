import { Form, redirect } from 'react-router';
import { currentUser, devLoginEnabled, signIn, signInOptions } from '@/lib/auth.server';
import { getConfig } from '@/lib/config.server';
import type { Route } from './+types/login';

export const meta = () => [{ title: 'Sign in' }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await currentUser(request);
  if (user?.status === 'active') throw redirect('/');
  const config = await getConfig();
  return {
    title: config.title,
    ...(await signInOptions()),
    pending: user?.status === 'pending' ? user.email : undefined,
    blocked: user?.status === 'blocked',
    error: new URL(request.url).searchParams.get('error') ?? undefined,
  };
}

/** Development only: sign in as any email */
export async function action({ request }: Route.ActionArgs) {
  if (!devLoginEnabled(await getConfig())) throw new Response('Not found', { status: 404 });
  const email = String((await request.formData()).get('email') ?? '').trim();
  if (!email.includes('@')) return { error: 'Enter an email address' };
  return signIn(request, { email, provider: 'dev' });
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const { title, providers, devLogin, pending, blocked } = loaderData;
  const error = actionData?.error ?? loaderData.error;
  return (
    <main className="signin">
      <h1>{title}</h1>
      <p className="muted">Send and receive MECA packages over SWORD v3.</p>
      {error && <div className="panel error-box">{error}</div>}
      {pending && (
        <div className="panel notice">
          Thanks, <strong>{pending}</strong>. Your access is waiting for approval; we'll let you
          know when it's ready.
        </div>
      )}
      {blocked && <div className="panel error-box">This account doesn't have access.</div>}
      {providers.map((p) => (
        <a key={p.id} className="button primary" href={`/auth/${p.id}`}>
          Sign in with {p.name}
        </a>
      ))}
      {providers.length === 0 && !devLogin && (
        <p className="muted">No sign-in providers are configured.</p>
      )}
      {devLogin && (
        <Form method="post">
          <fieldset>
            <label htmlFor="email">Development sign-in</label>
            <input id="email" name="email" type="email" placeholder="you@example.org" required />
            <p className="muted">Signs in as any email; only offered in development.</p>
            <button type="submit">Sign in</button>
          </fieldset>
        </Form>
      )}
      {(pending || blocked) && (
        <Form method="post" action="/logout">
          <button className="link" type="submit">
            Use a different account
          </button>
        </Form>
      )}
    </main>
  );
}
