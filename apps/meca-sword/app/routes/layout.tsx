import { Form, NavLink, Outlet } from 'react-router';
import { requireUser } from '@/lib/auth.server';
import { getConfig } from '@/lib/config.server';
import type { Route } from './+types/layout';

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const config = await getConfig();
  return { title: config.title, email: user.email, isAdmin: user.role === 'admin' };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { title, email, isAdmin } = loaderData;
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');
  return (
    <>
      <header>
        <h1>{title}</h1>
        <nav>
          <NavLink to="/" end className={link}>
            Inbox
          </NavLink>
          {isAdmin && (
            <>
              <NavLink to="/packages" className={link}>
                Packages
              </NavLink>
              <NavLink to="/destinations" className={link}>
                Destinations
              </NavLink>
              <NavLink to="/outbox" className={link}>
                Outbox
              </NavLink>
            </>
          )}
          <NavLink to="/api-keys" className={link}>
            API keys
          </NavLink>
        </nav>
        <Form method="post" action="/logout" className="inline">
          <span className="muted">{email}</span>{' '}
          <button className="link" type="submit">
            Sign out
          </button>
        </Form>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
