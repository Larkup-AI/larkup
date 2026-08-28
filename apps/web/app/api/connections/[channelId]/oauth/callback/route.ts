import { getChannel } from '@larkup/connections';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CallbackMessage =
  | {
      type: 'channel_oauth';
      channelId: string;
      status: 'connected';
      fields: Record<string, string>;
      team?: string;
    }
  | { type: 'channel_oauth'; channelId: string; status: 'error'; error: string };

function responseHtml(message: CallbackMessage) {
  return new NextResponse(
    `<!doctype html><html><body><script>if(window.opener){window.opener.postMessage(${JSON.stringify(
      message,
    )},window.location.origin);window.close();}else{window.location.href='/settings?section=runtime&tab=connections';}</script><p>Connection setup complete. You can close this window.</p></body></html>`,
    { headers: { 'Content-Type': 'text/html' } },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  const channel = getChannel(channelId);
  if (!channel?.oauthConnect)
    return new NextResponse('OAuth is not available for this connection.', { status: 404 });

  const { searchParams } = new URL(request.url);
  const providerError = searchParams.get('error');
  if (providerError) {
    return responseHtml({
      type: 'channel_oauth',
      channelId,
      status: 'error',
      error: `${channel.name}: ${providerError}`,
    });
  }

  const fields = Object.fromEntries(
    Object.entries(channel.oauthConnect.callbackFields).flatMap(([parameter, field]) => {
      const value = searchParams.get(parameter);
      return value ? [[field, value]] : [];
    }),
  );
  if (!Object.keys(fields).length) {
    return responseHtml({
      type: 'channel_oauth',
      channelId,
      status: 'error',
      error: `${channel.name} authorization did not return credentials. Try connecting again.`,
    });
  }

  return responseHtml({
    type: 'channel_oauth',
    channelId,
    status: 'connected',
    fields,
    team: searchParams.get('team') ?? undefined,
  });
}
