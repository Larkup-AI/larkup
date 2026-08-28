import { getChannel } from '@larkup/connections';
import { redirect } from 'next/navigation';
import { managedChannelsProxyUrl } from '@/lib/connections/managed-channel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  const channel = getChannel(channelId);
  if (!channel?.oauthConnect)
    return new Response('OAuth is not available for this connection.', { status: 404 });

  const proxyUrl = managedChannelsProxyUrl();
  const providerId = channel.oauthConnect.managedProviderId ?? channel.id;
  const authorizeUrl = new URL(
    `${encodeURIComponent(providerId)}/oauth`,
    `${proxyUrl.replace(/\/$/, '')}/`,
  );
  authorizeUrl.searchParams.set(
    'redirect_to',
    new URL(`/api/connections/${channelId}/oauth/callback`, request.url).toString(),
  );
  redirect(authorizeUrl.toString());
}
