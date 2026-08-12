/**
 * Configuration validation, driven by the adapter's own `configFields`.
 *
 * Plan §4.2: the schema drives the settings form. The dashboard renders these
 * fields and the server validates against the same declaration, so adding a
 * channel never means hand-writing a validation branch.
 */

import type { ChannelAdapter } from './types';

export interface ChannelValidationResult {
  ok: boolean;
  /** Field key → message. Empty when `ok`. */
  errors: Record<string, string>;
}

export function validateChannelSettings(
  adapter: ChannelAdapter,
  settings: Record<string, string>,
): ChannelValidationResult {
  const errors: Record<string, string> = {};

  for (const field of adapter.configFields) {
    const value = (settings[field.key] ?? '').trim();

    if (!value) {
      if (field.required) errors[field.key] = `${field.label} is required.`;
      continue;
    }

    if (field.type === 'url') {
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          errors[field.key] = `${field.label} must be an http(s) URL.`;
        }
      } catch {
        errors[field.key] = `${field.label} must be a valid URL.`;
      }
    }

    if (field.type === 'boolean' && value !== 'true' && value !== 'false') {
      errors[field.key] = `${field.label} must be true or false.`;
    }
  }

  // An unknown key is almost always a typo in a hand-edited config; surfacing
  // it beats silently ignoring a setting the operator believes is active.
  const known = new Set(adapter.configFields.map((f) => f.key));
  for (const key of Object.keys(settings)) {
    if (!known.has(key)) errors[key] = `Unknown setting "${key}" for the ${adapter.name} channel.`;
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
