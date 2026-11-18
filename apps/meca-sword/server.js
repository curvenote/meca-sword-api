// Production server: what `react-router-serve` does, plus `trust proxy`. Cloud Run ends TLS in
// front of the container, so without it request.url is http:// while the browser's Origin is
// https://, and React Router rejects every form post as cross-origin (400).
//
//   node server.js   # from apps/meca-sword, after `bun run build`
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequestHandler } from '@react-router/express';
import compression from 'compression';
import express from 'express';
import morgan from 'morgan';

const build = await import(pathToFileURL(path.resolve('build/server/index.js')).href);
const port = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
// Only the protocol should come from the proxy (Cloud Run sets X-Forwarded-Proto); it doesn't
// set X-Forwarded-Host, so a client could, and the host must come from the real Host header.
app.use((req, _res, next) => {
  delete req.headers['x-forwarded-host'];
  next();
});
app.use(compression());
app.use('/assets', express.static('build/client/assets', { immutable: true, maxAge: '1y' }));
app.use(express.static('build/client'));
app.use(morgan('tiny'));
app.all('*', createRequestHandler({ build, mode: process.env.NODE_ENV }));

const server = app.listen(port, () => console.log(`meca-sword listening on port ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => server.close(console.error));
}
