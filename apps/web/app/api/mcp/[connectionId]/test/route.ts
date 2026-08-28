import { NextRequest, NextResponse } from 'next/server';
import { testMcpConnection } from '@larkup/core/mcp-store';

type Params = { params: Promise<{ connectionId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { connectionId } = await params;
    return NextResponse.json(await testMcpConnection(connectionId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: message.includes('not found') ? 404 : 502 },
    );
  }
}
