/**
 * End-user and session mapping.
 *
 * A channel gives us a provider-scoped user id (`telegram:441122`) and a
 * conversation id. The runtime needs a stable session id so a follow-up message
 * continues the same conversation, and it must be impossible for one channel's
 * ids to collide with another's.
 */

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

/**
 * Derive the session and end-user ids for an inbound message.
 *
 * Hashed rather than concatenated so a provider id — which may be a phone
 * number on WhatsApp — never appears verbatim in a log, a trace, or a stored
 * transcript.
 */
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
