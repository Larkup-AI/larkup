/**
 * Knowledge Integration OAuth Proxy (plan §10).
 *
 * Deploys and owns its own environment separately from the Agent Runtime
 * (`apps/web`) and the Marketplace (`apps/hub`) — see
 * `docs/deploy/larkup-proxy/README.md`. Limited to OAuth for read-only
 * knowledge-source integrations; it is not a channel runtime and never
 * becomes one, whatever a provider's name might suggest it could do.
 */
import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import oauthRoute from './routes/oauth.js';

const app = new Hono();

app.get('/', (c) => c.text('Larkup Knowledge Integration OAuth Proxy is running.'));

const apiApp = new Hono();
apiApp.get('/health', (c) => c.json({ status: 'ok', service: 'larkup-proxy' }));

// Registry-backed OAuth routes: /api/oauth/:integration and callback.
apiApp.route('/oauth', oauthRoute);

app.route('/api', apiApp);

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);

// Testability only — Vercel's routing only looks at the named exports above.
export default app;
