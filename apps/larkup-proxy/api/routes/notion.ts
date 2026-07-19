import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  const redirectTo = c.req.query('redirect_to')
  if (!redirectTo) return c.text('Missing redirect_to', 400)

  const clientId = process.env.NOTION_CLIENT_ID
  if (!clientId) return c.text('Proxy not configured', 500)

  // Use the origin from the request URL to ensure it matches the domain accessed
  const origin = new URL(c.req.url).origin;
  const host = process.env.NODE_ENV === "development" ? "http://localhost:3000" : origin;
    
  // The Notion callback URI configured in your Notion Developer Portal
  const proxyCallback = `${host}/api/oauth/notion/callback`
  
  const state = encodeURIComponent(redirectTo)
  const url = `https://api.notion.com/v1/oauth/authorize?client_id=${clientId}&response_type=code&owner=user&redirect_uri=${encodeURIComponent(proxyCallback)}&state=${state}`
  
  return c.redirect(url)
})

app.get('/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error) return c.text(`Notion auth error: ${error}`, 400)
  if (!code || !state) return c.text('Missing code or state', 400)

  const redirectTo = decodeURIComponent(state)
  
  const origin = new URL(c.req.url).origin;
  const host = process.env.NODE_ENV === "development" ? "http://localhost:3000" : origin;
  const proxyCallback = `${host}/api/oauth/notion/callback`
  
  const clientId = process.env.NOTION_CLIENT_ID
  const clientSecret = process.env.NOTION_CLIENT_SECRET

  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: proxyCallback,
    }),
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    return c.text(`Failed to exchange token: ${text}`, 400)
  }

  const data = await tokenRes.json()
  const accessToken = data.access_token

  // Redirect back to user's local instance with the token
  const finalRedirect = new URL(redirectTo)
  finalRedirect.searchParams.set('token', accessToken)
  return c.redirect(finalRedirect.toString())
})

export default app
