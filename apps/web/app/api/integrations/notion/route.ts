import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/notion → Returns connection status and connected pages.
 */
export async function GET() {
  const token = process.env.NOTION_ACCESS_TOKEN;
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;

  if (!token) {
    return NextResponse.json({
      connected: false,
      configured: !!(clientId && clientSecret),
      pages: [],
    });
  }

  try {
    // Use search endpoint to discover accessible pages
    const res = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: { property: 'object', value: 'page' },
        page_size: 100,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json({
        connected: false,
        configured: true,
        error: err.message || 'Failed to connect to Notion',
        pages: [],
      });
    }

    const data = await res.json();
    const pages = (data.results || []).map((page: any) => ({
      id: page.id,
      title: extractTitle(page),
      icon: page.icon?.emoji || page.icon?.external?.url || null,
      url: page.url,
      lastEdited: page.last_edited_time,
      parentType: page.parent?.type || 'workspace',
    }));

    // Also fetch databases
    const dbRes = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: { property: 'object', value: 'database' },
        page_size: 100,
      }),
    });

    let databases: any[] = [];
    if (dbRes.ok) {
      const dbData = await dbRes.json();
      databases = (dbData.results || []).map((db: any) => ({
        id: db.id,
        title: db.title?.[0]?.plain_text || 'Untitled Database',
        icon: db.icon?.emoji || db.icon?.external?.url || null,
        url: db.url,
        lastEdited: db.last_edited_time,
        type: 'database' as const,
      }));
    }

    return NextResponse.json({
      connected: true,
      configured: true,
      pages,
      databases,
    });
  } catch (err) {
    return NextResponse.json(
      {
        connected: false,
        configured: true,
        error: err instanceof Error ? err.message : 'Connection failed',
        pages: [],
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/notion → Import selected Notion pages into the corpus.
 * Body: { pageIds: string[] }
 */
export async function POST(req: Request) {
  const token = process.env.NOTION_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: 'Notion not connected. Set NOTION_ACCESS_TOKEN.' },
      { status: 400 },
    );
  }

  try {
    const { pageIds } = (await req.json()) as { pageIds: string[] };
    if (!pageIds?.length) {
      return NextResponse.json({ error: 'No pages selected.' }, { status: 400 });
    }

    const results: { id: string; title: string; status: string; error?: string }[] = [];

    for (const pageId of pageIds) {
      try {
        // Fetch page content as blocks
        const content = await fetchPageContent(token, pageId);
        const pageInfo = await fetchPageInfo(token, pageId);
        const title = extractTitle(pageInfo);

        // Add to documents corpus
        const docRes = await fetch(new URL('/api/documents', req.url).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title || 'Untitled Notion Page',
            content,
            source: 'paste',
            url: pageInfo.url,
            metadata: {
              notionPageId: pageId,
              importedFrom: 'notion',
            },
          }),
        });

        if (!docRes.ok) {
          const err = await docRes.json();
          results.push({ id: pageId, title, status: 'failed', error: err.error });
        } else {
          results.push({ id: pageId, title, status: 'success' });
        }
      } catch (err) {
        results.push({
          id: pageId,
          title: pageId,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length;
    return NextResponse.json({
      imported: successCount,
      total: pageIds.length,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed.' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/notion → Disconnect Notion by removing the access token.
 */
export async function DELETE() {
  try {
    const envPath = resolve(process.cwd(), '.env.local');
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf-8');
      if (envContent.includes('NOTION_ACCESS_TOKEN=')) {
        const updated = envContent.replace(/NOTION_ACCESS_TOKEN=.*\n?/g, '');
        writeFileSync(envPath, updated, 'utf-8');
      }
    }
    delete process.env.NOTION_ACCESS_TOKEN;

    return NextResponse.json({ success: true, message: 'Disconnected from Notion' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to disconnect' },
      { status: 500 },
    );
  }
}

// ---------- Helpers ----------

function extractTitle(page: any): string {
  // Try page title from properties
  const props = page.properties || {};
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop.type === 'title' && prop.title?.length > 0) {
      return prop.title.map((t: any) => t.plain_text).join('');
    }
  }
  // Fallback
  return page.title?.[0]?.plain_text || 'Untitled';
}

async function fetchPageInfo(token: string, pageId: string) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch page ${pageId}`);
  return res.json();
}

async function fetchPageContent(token: string, pageId: string): Promise<string> {
  const blocks: any[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    if (cursor) url.searchParams.set('start_cursor', cursor);
    url.searchParams.set('page_size', '100');

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!res.ok) throw new Error(`Failed to fetch blocks for ${pageId}`);
    const data = await res.json();
    blocks.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return blocksToMarkdown(blocks);
}

function blocksToMarkdown(blocks: any[]): string {
  return blocks
    .map((block) => {
      const type = block.type;
      const content = block[type];

      switch (type) {
        case 'paragraph':
          return richTextToPlain(content?.rich_text) + '\n';
        case 'heading_1':
          return `# ${richTextToPlain(content?.rich_text)}\n`;
        case 'heading_2':
          return `## ${richTextToPlain(content?.rich_text)}\n`;
        case 'heading_3':
          return `### ${richTextToPlain(content?.rich_text)}\n`;
        case 'bulleted_list_item':
          return `- ${richTextToPlain(content?.rich_text)}`;
        case 'numbered_list_item':
          return `1. ${richTextToPlain(content?.rich_text)}`;
        case 'to_do':
          return `- [${content?.checked ? 'x' : ' '}] ${richTextToPlain(content?.rich_text)}`;
        case 'toggle':
          return richTextToPlain(content?.rich_text);
        case 'quote':
          return `> ${richTextToPlain(content?.rich_text)}\n`;
        case 'callout':
          return `> ${content?.icon?.emoji || '💡'} ${richTextToPlain(content?.rich_text)}\n`;
        case 'code':
          return `\`\`\`${content?.language || ''}\n${richTextToPlain(
            content?.rich_text,
          )}\n\`\`\`\n`;
        case 'divider':
          return '---\n';
        case 'image':
          return `![image](${content?.file?.url || content?.external?.url || ''})\n`;
        case 'bookmark':
          return `[${content?.url}](${content?.url})\n`;
        case 'link_preview':
          return `[${content?.url}](${content?.url})\n`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

function richTextToPlain(richText: any[]): string {
  if (!richText) return '';
  return richText.map((t: any) => t.plain_text || '').join('');
}
