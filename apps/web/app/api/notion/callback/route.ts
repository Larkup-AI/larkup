import { NextResponse } from "next/server";
import { appendFileSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/notion/callback?code=xxx
 * Handles the OAuth callback from Notion, exchanging the code for an access token.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/data?notion=error", req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/data?notion=missing_code", req.url));
  }

  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/data?notion=not_configured", req.url),
    );
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
        redirect_uri: `${new URL(req.url).origin}/api/notion/callback`,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      console.error("Notion OAuth error:", err);
      return NextResponse.redirect(new URL("/data?notion=auth_failed", req.url));
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return NextResponse.redirect(new URL("/data?notion=no_token", req.url));
    }

    // Persist token to .env file
    const envPath = resolve(process.cwd(), ".env");
    const envLine = `\nNOTION_ACCESS_TOKEN=${accessToken}\n`;

    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, "utf-8");
      if (envContent.includes("NOTION_ACCESS_TOKEN=")) {
        // Replace existing token
        const updated = envContent.replace(
          /NOTION_ACCESS_TOKEN=.*/,
          `NOTION_ACCESS_TOKEN=${accessToken}`,
        );
        const { writeFileSync } = await import("fs");
        writeFileSync(envPath, updated, "utf-8");
      } else {
        appendFileSync(envPath, envLine);
      }
    } else {
      appendFileSync(envPath, envLine);
    }

    // Set it for the current process
    process.env.NOTION_ACCESS_TOKEN = accessToken;

    return NextResponse.redirect(new URL("/data?notion=connected", req.url));
  } catch (err) {
    console.error("Notion OAuth callback error:", err);
    return NextResponse.redirect(new URL("/data?notion=error", req.url));
  }
}
