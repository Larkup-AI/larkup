import { NextResponse } from "next/server";
import { appendFileSync, readFileSync, existsSync, writeFileSync } from "fs";
import { resolve } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getResponseHtml(status: string) {
  return `
    <!DOCTYPE html>
    <html>
      <head><title>Notion Authentication</title></head>
      <body>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'notion_oauth', status: '${status}' }, '*');
            window.close();
          } else {
            window.location.href = "/data?notion=${status}";
          }
        </script>
        <p>Authentication complete. You can close this window.</p>
      </body>
    </html>
  `;
}

function htmlResponse(status: string) {
  return new NextResponse(getResponseHtml(status), {
    headers: { "Content-Type": "text/html" },
  });
}

function saveTokenLocally(accessToken: string) {
  const envPath = resolve(process.cwd(), ".env.local");
  const envLine = `\nNOTION_ACCESS_TOKEN="${accessToken}"\n`;

  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf-8");
    if (envContent.includes("NOTION_ACCESS_TOKEN=")) {
      const updated = envContent.replace(
        /NOTION_ACCESS_TOKEN=.*/g,
        `NOTION_ACCESS_TOKEN="${accessToken}"`
      );
      writeFileSync(envPath, updated, "utf-8");
    } else {
      appendFileSync(envPath, envLine);
    }
  } else {
    appendFileSync(envPath, envLine);
  }

  process.env.NOTION_ACCESS_TOKEN = accessToken;
}

/**
 * GET /api/integrations/notion/callback
 * Handles the OAuth callback from Notion or from the Centralized Proxy.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const token = searchParams.get("token");
  const error = searchParams.get("error");

  if (error) {
    return htmlResponse("error");
  }

  // If a proxy server already exchanged the code and provided the access token
  if (token) {
    saveTokenLocally(token);
    return htmlResponse("connected");
  }

  if (!code) {
    return htmlResponse("missing_code");
  }

  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return htmlResponse("not_configured");
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${new URL(req.url).origin}/api/integrations/notion/callback`,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      console.error("Notion OAuth error:", err);
      return htmlResponse("auth_failed");
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return htmlResponse("no_token");
    }

    saveTokenLocally(accessToken);

    return htmlResponse("connected");
  } catch (err) {
    console.error("Notion OAuth callback error:", err);
    return htmlResponse("error");
  }
}
