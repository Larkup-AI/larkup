import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDataDir, requireDataDir } from '@larkup/core/workspace';

async function getConnectionsFile(create: boolean) {
  const dir = create ? await requireDataDir() : await getDataDir();
  if (!dir) return null;
  return path.join(dir, 'connections.json');
}

export async function GET() {
  try {
    const file = await getConnectionsFile(false);
    if (!file) return NextResponse.json({});

    try {
      const raw = await fs.readFile(file, 'utf8');
      return NextResponse.json(JSON.parse(raw));
    } catch {
      return NextResponse.json({});
    }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const file = await getConnectionsFile(true);
    if (!file) throw new Error('No workspace directory');

    await fs.writeFile(file, JSON.stringify(body, null, 2), 'utf8');
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
