import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { getInstalledTool } from '@larkup/marketplace/installer';

export const runtime = 'nodejs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sends a small, operator-actionable capacity request without exposing an AWS or GPU endpoint. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    note?: unknown;
    usage?: unknown;
  } | null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2_000) : '';
  if (!EMAIL.test(email)) {
    return NextResponse.json({ error: 'Enter a valid work email address.' }, { status: 400 });
  }

  const [tool, config] = await Promise.all([getInstalledTool('video-intelligence'), readConfig()]);
  if (!tool)
    return NextResponse.json({ error: 'Video Intelligence is not installed.' }, { status: 404 });

  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.LARKUP_USAGE_REQUEST_FROM;
  const to = process.env.LARKUP_USAGE_REQUEST_TO;
  if (!resendKey || !from || !to) {
    return NextResponse.json(
      { error: 'Usage requests are not configured yet. Please contact your Larkup administrator.' },
      { status: 503 },
    );
  }

  const usage = body?.usage && typeof body.usage === 'object' ? body.usage : {};
  const message = [
    'Video Intelligence capacity request',
    `Contact: ${email}`,
    `Project: ${config.projectName || 'Unnamed project'}`,
    `Usage: ${JSON.stringify(usage)}`,
    note ? `Note: ${note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject: 'Larkup Video capacity request',
      text: message,
    }),
  });
  if (!response.ok) {
    return NextResponse.json(
      { error: 'Could not send the usage request. Please try again.' },
      { status: 502 },
    );
  }
  return NextResponse.json({ status: 'sent' }, { status: 202 });
}
