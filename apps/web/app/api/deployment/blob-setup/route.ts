import { NextResponse } from 'next/server';
import { readDeploymentConfig, writeDeploymentConfig } from '@larkup/core/deployment-store';

export async function GET() {
  try {
    const config = await readDeploymentConfig();
    return NextResponse.json({ connected: !!config.vercelBlobToken });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { token } = await req.json();
    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    const config = await readDeploymentConfig();
    config.vercelBlobToken = token;
    await writeDeploymentConfig(config);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
