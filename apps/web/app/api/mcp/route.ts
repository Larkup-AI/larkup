import { NextRequest, NextResponse } from 'next/server';
import { createMcpConnection, listMcpConnections } from '@larkup/core/mcp-store';

/** Workspace MCP connections. Credentials are redacted by the core store. */
export async function GET() {
  try {
    return NextResponse.json({ connections: await listMcpConnections() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const connection = await createMcpConnection(await req.json());
    return NextResponse.json(connection, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
