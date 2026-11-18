import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';
import type { Route } from './+types/root';
import styles from './app.css?url';

export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: styles }];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const [title, detail] = isRouteErrorResponse(error)
    ? [error.status === 404 ? 'Not found' : `Error ${error.status}`, error.data]
    : ['Something went wrong', error instanceof Error ? error.message : undefined];
  return (
    <main>
      <h1>{title}</h1>
      {detail && <p className="muted">{String(detail)}</p>}
      <p>
        <a href="/">Back to the inbox</a>
      </p>
    </main>
  );
}
