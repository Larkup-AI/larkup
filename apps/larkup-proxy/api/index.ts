/**
 * Knowledge Integration OAuth Proxy
 */
import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import channelRoute from './routes/channels.js';
import oauthRoute from './routes/oauth.js';

const app = new Hono();

app.get('/', (c) =>
  c.html(
    '<!doctype html><html><head><link rel="icon" href="/favicon.svg" type="image/svg+xml"><title>Larkup Proxy</title></head><body>Larkup OAuth Proxy is running.</body></html>',
  ),
);

const apiApp = new Hono();
apiApp.get('/health', (c) => c.json({ status: 'ok', service: 'larkup-proxy' }));

// Registry-backed OAuth routes: /api/oauth/:integration and callback.
apiApp.route('/oauth', oauthRoute);
// Managed chat OAuth/signature verification, intentionally isolated from
// read-only knowledge integrations above.
apiApp.route('/channels', channelRoute);

app.route('/api', apiApp);

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);

// Testability only >  Vercel's routing only looks at the named exports above.
export default app;
