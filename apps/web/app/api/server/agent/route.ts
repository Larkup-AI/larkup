import { NextResponse } from 'next/server';
import {
  startAgentServer,
  stopAgentServer,
  refreshAgentServerStatus,
} from '@larkup/core/generator/server-runtime';
import { readConfig } from '@larkup/core/config-store';
import { requireDataDir } from '@larkup/core/workspace';

export async function GET() {
  try {
    await requireDataDir();
    const state = await refreshAgentServerStatus();
    return NextResponse.json(state);
  } catch (error) {
    if (String(error).includes('No workspace data directory')) {
      return NextResponse.json({ running: false }, { status: 404 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() {
  try {
    const config = await readConfig();
    const state = await startAgentServer(config);
    return NextResponse.json(state);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const state = await stopAgentServer();
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
