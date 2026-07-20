import { NextResponse } from 'next/server';
import { getToolById } from '@larkup/marketplace/registry';
import {
  installTool,
  uninstallTool,
  isToolInstalled,
  getInstalledTool,
} from '@larkup/marketplace/installer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → get tool details. */
export async function GET(_req: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const descriptor = await getToolById(toolId);
  if (!descriptor) {
    return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  }

  const installed = await getInstalledTool(toolId);
  return NextResponse.json({
    tool: descriptor,
    installed: installed ?? null,
  });
}

/** POST → install a tool. */
export async function POST(_req: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const descriptor = await getToolById(toolId);
  if (!descriptor) {
    return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  }

  if (descriptor.comingSoon) {
    return NextResponse.json({ error: `${descriptor.name} is coming soon.` }, { status: 400 });
  }

  const alreadyInstalled = await isToolInstalled(toolId);
  if (alreadyInstalled) {
    return NextResponse.json({ status: 'already-installed' });
  }

  try {
    await installTool(toolId);
    return NextResponse.json({ status: 'installed' }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Install failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE → uninstall a tool. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  await uninstallTool(toolId);
  return NextResponse.json({ status: 'uninstalled' });
}
