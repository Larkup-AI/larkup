import { NextResponse } from 'next/server';
import * as http from 'node:http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { server, username, password } = await req.json();

    if (!server) {
      return NextResponse.json({ error: 'Proxy server URL is required' }, { status: 400 });
    }

    let proxyUrl: URL;
    try {
      proxyUrl = new URL(server);
    } catch {
      return NextResponse.json({ error: 'Invalid proxy server URL' }, { status: 400 });
    }

    await new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        Host: 'example.com',
      };

      if (username && password) {
        const auth = Buffer.from(`${username}:${password}`).toString('base64');
        headers['Proxy-Authorization'] = `Basic ${auth}`;
      }

      const options: http.RequestOptions = {
        hostname: proxyUrl.hostname,
        port: proxyUrl.port || (proxyUrl.protocol === 'https:' ? 443 : 80),
        path: 'http://example.com/',
        method: 'GET',
        headers,
        timeout: 10000,
      };

      const request = http.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
          resolve(true);
        } else {
          reject(new Error(`Proxy returned status code ${res.statusCode}`));
        }
      });

      request.on('error', (err) => {
        reject(err);
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Proxy verification timed out'));
      });

      request.end();
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
