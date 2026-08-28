import { NextRequest, NextResponse } from 'next/server';
import { deleteMcpConnection, updateMcpConnection } from '@larkup/core/mcp-store';

type Params = { params: Promise<{ connectionId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { connectionId } = await params;
    const updated = await updateMcpConnection(connectionId, await req.json());
    if (!updated) return NextResponse.json({ error: 'MCP connection not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { connectionId } = await params;
    if (!(await deleteMcpConnection(connectionId))) {
      return NextResponse.json({ error: 'MCP connection not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
