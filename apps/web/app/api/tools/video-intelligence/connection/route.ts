import { NextResponse } from 'next/server';
import { loadToolExtension } from '@larkup/marketplace/extension';
import { getInstalledTool } from '@larkup/marketplace/installer';
import { resolveVideoIntelligenceConnection } from '@/lib/media/video-intelligence-connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ConnectionClient = {
  health(): Promise<unknown>;
  getUsage(): Promise<unknown>;
  provisionDeviceAccess(installationId: string): Promise<{
    apiKey: string;
    entitlement: {
      plan: string;
      sourceMinutesPerMonth: number | null;
      maxConcurrentJobs: number;
      allowFullCoverage: boolean;
    };
  }>;
};

export async function GET() {
  const [installed, extension] = await Promise.all([
    getInstalledTool('video-intelligence'),
    loadToolExtension<ConnectionClient>('video-intelligence'),
  ]);
  if (!installed || !extension?.createClient) {
    return NextResponse.json({ error: 'Video Intelligence is not installed.' }, { status: 404 });
  }
  try {
    const connection = await resolveVideoIntelligenceConnection(extension, installed.config);
    const client = extension.createClient({ config: connection.config, fetch: globalThis.fetch });
    const [, usage] = await Promise.all([client.health(), client.getUsage()]);
    return NextResponse.json({
      status: 'connected',
      provisioned: connection.provisioned,
      entitlement: connection.entitlement,
      usage,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Could not create the managed Larkup Cloud connection.',
      },
      { status: 503 },
    );
  }
}
