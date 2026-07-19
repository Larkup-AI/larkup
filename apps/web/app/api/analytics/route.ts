import { NextResponse } from 'next/server';
import { getAnalyticsSummary } from '@larkup/core/analytics-store';
import { runWithServer } from '@larkup/core/workspace';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const serverId = url.searchParams.get('serverId');
  const timeframe = url.searchParams.get('timeframe') || '30d';

  let days = 30;
  if (timeframe === '7d') days = 7;
  else if (timeframe === '14d') days = 14;
  else if (timeframe === '30d') days = 30;
  else if (timeframe === '90d') days = 90;
  else if (timeframe === 'all') days = 0;

  const getSummary = async () => {
    return await getAnalyticsSummary(days);
  };

  try {
    const summary = serverId ? await runWithServer(serverId, getSummary) : await getSummary();

    return NextResponse.json(summary);
  } catch (error: any) {
    console.error('Analytics fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
