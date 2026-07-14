import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

// Enable CORS for all routes (important for desktop/web clients)
app.use('*', cors())

// Basic health check
app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'larkup-api' })
})

// Enterprise license verification
app.post('/api/license/verify', async (c) => {
  try {
    const body = await c.req.json()
    const { key } = body

    if (!key) {
      return c.json({ valid: false, error: 'Key is required' }, 400)
    }

    // Default demo key if env is not set
    const validKey = process.env.LARKUP_ENTERPRISE_KEY || 'LARK-DEMO-2026-ENTERPRISE'

    if (key === validKey) {
      return c.json({
        valid: true,
        edition: 'enterprise',
        expiresAt: '2030-01-01T00:00:00.000Z' // Demo expiration
      })
    } else {
      return c.json({ valid: false, error: 'Invalid license key' }, 401)
    }
  } catch (error) {
    return c.json({ valid: false, error: 'Invalid request payload' }, 400)
  }
})

export default app
