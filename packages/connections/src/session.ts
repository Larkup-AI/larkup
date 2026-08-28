/** Stable, provider-scoped session mapping. */

import { createHash } from 'node:crypto';

export interface ChannelSession {
  /** Stable, opaque session id for this (agent, channel, conversation). */
  sessionId: string;
  /** Stable, opaque end-user id, scoped to the channel. */
  endUserId: string;
}

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 24);
}

/** Hash provider IDs before storing or logging them. */
export function deriveSession(params: {
  agentId: string;
  channelId: string;
  conversationId: string;
  endUserId: string;
}): ChannelSession {
  const scope = `${params.agentId}:${params.channelId}`;
  return {
    sessionId: `sess_${shortHash(`${scope}:conv:${params.conversationId}`)}`,
    endUserId: `usr_${shortHash(`${scope}:user:${params.endUserId}`)}`,
  };
}
