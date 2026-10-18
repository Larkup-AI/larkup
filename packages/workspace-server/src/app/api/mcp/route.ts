import { createMcpConnection, listMcpConnections } from '@larkup/core/mcp-store';

/** Workspace MCP connections. Credentials are redacted by the core store. */
export async function GET() {
  try {
    return Response.json({ connections: await listMcpConnections() });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const connection = await createMcpConnection(await req.json());
    return Response.json(connection, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
