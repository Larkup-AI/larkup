import { deleteMcpConnection, updateMcpConnection } from '@larkup/core/mcp-store';

type Params = { params: Promise<{ connectionId: string }> };

export async function PUT(req: Request, { params }: Params) {
  try {
    const { connectionId } = await params;
    const updated = await updateMcpConnection(connectionId, await req.json());
    if (!updated) return Response.json({ error: 'MCP connection not found' }, { status: 404 });
    return Response.json(updated);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { connectionId } = await params;
    if (!(await deleteMcpConnection(connectionId))) {
      return Response.json({ error: 'MCP connection not found' }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
