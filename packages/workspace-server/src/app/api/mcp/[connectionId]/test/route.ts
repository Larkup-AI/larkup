import { testMcpConnection } from '@larkup/core/mcp-store';

type Params = { params: Promise<{ connectionId: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    const { connectionId } = await params;
    return Response.json(await testMcpConnection(connectionId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message.includes('not found') ? 404 : 502 });
  }
}
