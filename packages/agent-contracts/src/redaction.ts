/**
 * Secret redaction for `AgentDefinition`.
 *
 * An agent config accumulates credentials as the product grows: knowledge-server
 * retrieval keys (TASK 01), join codes (TASK 05), channel bot tokens and signing
 * secrets (TASK 06). All of them live server-side in
 * `.larkup/agents/<id>/config.json`, and none of them may be sent to a browser
 * or written into a log — plan §8.3.
 *
 * The dashboard still has to *edit* an agent that holds secrets, which is the
 * awkward part: a GET → edit → PUT round-trip would otherwise write the masked
 * placeholder back over the real value. The solution is a sentinel:
 *
 * - `redactAgentSecrets()` replaces every stored secret with {@link REDACTED}.
 * - `mergeAgentUpdate()` drops any incoming field still equal to the sentinel,
 *   keeping the stored value.
 *
 * A field that was never set stays an empty string, so the dashboard can tell
 * "configured, hidden" apart from "not configured".
 */

import type { AgentChannelConfig, AgentDefinition } from './agent';

/** Placeholder standing in for a stored secret. Never a real credential. */
export const REDACTED = '__larkup_secret_set__';

/** Keys whose values are treated as secret wherever they appear in settings. */
const SECRET_SETTING_PATTERN = /(token|secret|key|password|signature|credential)/i;

function maskValue(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? REDACTED : '';
}

function redactSettings(settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings ?? {})) {
    out[key] = SECRET_SETTING_PATTERN.test(key) ? maskValue(value) : value;
  }
  return out;
}

/**
 * Return a copy of the definition safe to send to the dashboard.
 *
 * This is still an authenticated, operator-facing view — it exposes the system
 * prompt and knowledge-source URLs. The widget gets a much narrower projection
 * from `GET /api/agents/:id/public`.
 */
export function redactAgentSecrets(definition: AgentDefinition): AgentDefinition {
  const channels: Record<string, AgentChannelConfig> = {};
  for (const [id, channel] of Object.entries(definition.channels ?? {})) {
    channels[id] = { ...channel, settings: redactSettings(channel.settings) };
  }

  return {
    ...definition,
    joinCode: definition.joinCode ? REDACTED : definition.joinCode,
    knowledgeSources: (definition.knowledgeSources ?? []).map((source) => ({
      ...source,
      retrievalKey: maskValue(source.retrievalKey),
    })),
    ...(definition.channels ? { channels } : {}),
  };
}

/** Is this value the redaction sentinel rather than a real secret? */
export function isRedacted(value: unknown): boolean {
  return value === REDACTED;
}

/**
 * Apply a partial update to a stored definition, preserving any secret the
 * caller sent back unchanged as the sentinel.
 *
 * Non-secret fields are replaced wholesale, matching normal `PUT` semantics.
 * `id` and `createdAt` are immutable.
 */
export function mergeAgentUpdate(
  current: AgentDefinition,
  update: Partial<AgentDefinition>,
): AgentDefinition {
  const merged: AgentDefinition = {
    ...current,
    ...update,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };

  if (isRedacted(update.joinCode)) merged.joinCode = current.joinCode;

  if (update.knowledgeSources) {
    merged.knowledgeSources = update.knowledgeSources.map((source, index) => {
      if (!isRedacted(source.retrievalKey)) return source;
      // Match by baseUrl first — a reordered list must not swap credentials.
      const previous =
        (current.knowledgeSources ?? []).find((s) => s.baseUrl === source.baseUrl) ??
        (current.knowledgeSources ?? [])[index];
      return { ...source, retrievalKey: previous?.retrievalKey ?? '' };
    });
  }

  if (update.channels) {
    const channels: Record<string, AgentChannelConfig> = {};
    for (const [id, channel] of Object.entries(update.channels)) {
      const previous = current.channels?.[id];
      const settings: Record<string, string> = {};
      for (const [key, value] of Object.entries(channel.settings ?? {})) {
        settings[key] = isRedacted(value) ? previous?.settings?.[key] ?? '' : value;
      }
      channels[id] = { ...previous, ...channel, settings };
    }
    merged.channels = channels;
  }

  return merged;
}
