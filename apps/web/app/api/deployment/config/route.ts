import { NextResponse } from 'next/server';
import { readDeploymentConfig, writeDeploymentConfig } from '@larkup/core/deployment-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await readDeploymentConfig();
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const config = await writeDeploymentConfig(body);
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
