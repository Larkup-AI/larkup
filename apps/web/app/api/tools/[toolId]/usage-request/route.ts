import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { runWithProject } from '@larkup/core/project-store';
import { getInstalledTool } from '@larkup/marketplace/installer';
import { getToolById } from '@larkup/marketplace/registry';

export const runtime = 'nodejs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UsageSupport = {
  contactLabel?: string;
  description?: string;
  userIdConfigKey?: string;
};

function withProject<T>(request: Request, operation: () => Promise<T>) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? url.searchParams.get('serverId');
  return projectId ? runWithProject(projectId, operation) : operation();
}

/** Sends a tool-declared cloud-quota request without exposing provider credentials or billing. */
export async function POST(request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    note?: unknown;
    usage?: unknown;
  } | null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2_000) : '';
  if (!EMAIL.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  const [installed, descriptor] = await Promise.all([
    getInstalledTool(toolId),
    getToolById(toolId),
  ]);
  if (!installed || !descriptor) {
    return NextResponse.json({ error: 'Tool is not installed.' }, { status: 404 });
  }

  return withProject(request, async () => {
    const config = await readConfig();
    const support = (descriptor.usage?.support ?? {}) as UsageSupport;
    if (!support.userIdConfigKey) {
      return NextResponse.json(
        { error: 'This tool does not offer managed usage support.' },
        { status: 404 },
      );
    }

    const mergedConfig = { ...installed.config, ...(config.toolConfigs?.[toolId] ?? {}) };
    const userId = mergedConfig[support.userIdConfigKey];
    const usage = body?.usage && typeof body.usage === 'object' ? body.usage : {};
    const message = [
      `User ID: ${typeof userId === 'string' ? userId : 'Unavailable'}`,
      `Usage: ${JSON.stringify(usage)}`,
      note ? `Note: ${note}` : '',
    ]
      .filter(Boolean)
      .join('\\n');

    const response = await fetch(
      process.env.NEXT_PUBLIC_CONNECT_API_URL || 'https://www.larkup.de/api/connect',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: config.projectName || 'Unnamed project',
          email,
          message: `${descriptor.name} cloud access request\\n\\n${message}`,
        }),
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Could not send the request. Please try again.' },
        { status: 502 },
      );
    }
    return NextResponse.json({ status: 'sent' }, { status: 202 });
  });
}
