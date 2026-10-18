import {
  saveTabularDataset,
  listTabularDatasets,
  deleteTabularDataset,
} from '@larkup/core/tabular-store';
import { resolveGroupId, UnknownDataGroupError } from '@larkup/core/groups-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/tabular — List all tabular datasets (metadata only). */
export async function GET() {
  try {
    const datasets = await listTabularDatasets();
    return Response.json({ datasets });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list datasets';
    return Response.json({ error: message }, { status: 500 });
  }
}

/** POST /api/tabular — Save a new tabular dataset. */
export async function POST(req: Request) {
  try {
    const { fileName, rows, groupId } = await req.json();

    if (!fileName || !Array.isArray(rows) || rows.length === 0) {
      return Response.json(
        { error: 'fileName and non-empty rows array required' },
        { status: 400 },
      );
    }

    const dataset = await saveTabularDataset(fileName, rows, {
      groupId: await resolveGroupId(typeof groupId === 'string' ? groupId : undefined),
    });

    return Response.json({
      id: dataset.id,
      fileName: dataset.fileName,
      rowCount: dataset.rowCount,
      columns: dataset.columns,
      summary: dataset.summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save dataset';
    return Response.json(
      { error: message },
      { status: err instanceof UnknownDataGroupError ? 400 : 500 },
    );
  }
}

/** DELETE /api/tabular?id=... — Delete a tabular dataset. */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return Response.json({ error: 'id required' }, { status: 400 });
    }
    await deleteTabularDataset(id);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete dataset';
    return Response.json({ error: message }, { status: 500 });
  }
}
