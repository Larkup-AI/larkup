import { describe, expect, it } from 'vitest';
import {
  FALLBACK_STYLE,
  configFromDataset,
  hostFromScriptSrc,
  normalizeHost,
  resolveConfig,
  resolveStyle,
} from './config';
import type { PublicAgentConfig } from '../types';

describe('normalizeHost', () => {
  it('strips trailing slashes so URL building never doubles up', () => {
    expect(normalizeHost('https://acme.com/')).toBe('https://acme.com');
    expect(normalizeHost('  https://acme.com//  ')).toBe('https://acme.com');
  });
});

describe('hostFromScriptSrc', () => {
  it('derives the host from the script that loaded the widget', () => {
    expect(hostFromScriptSrc('https://acme.com/api/widget.js')).toBe('https://acme.com');
  });

  it('keeps a non-default port', () => {
    expect(hostFromScriptSrc('http://localhost:4567/api/widget.js')).toBe('http://localhost:4567');
  });

  it('returns null when there is no usable src', () => {
    expect(hostFromScriptSrc(null)).toBeNull();
    expect(hostFromScriptSrc('')).toBeNull();
  });
});

describe('configFromDataset', () => {
  it('reads the agent id and infers the host from the script src', () => {
    const config = configFromDataset({ agent: 'support-bot' }, 'https://acme.com/api/widget.js');
    expect(config).toMatchObject({ agentId: 'support-bot', host: 'https://acme.com' });
  });

  it('lets an explicit data-host override the script origin', () => {
    const config = configFromDataset(
      { agent: 'bot', host: 'https://agents.acme.com/' },
      'https://cdn.other.com/widget.js',
    );
    expect(config.host).toBe('https://agents.acme.com');
  });

  it('accepts data-agent-id as an alias', () => {
    expect(configFromDataset({ agentId: 'bot' }).agentId).toBe('bot');
  });

  it('collects style overrides only for attributes that were set', () => {
    const config = configFromDataset({
      agent: 'bot',
      host: 'https://acme.com',
      primaryColor: '#ff0055',
      position: 'bottom-left',
      theme: 'dark',
      title: 'Support',
    });
    expect(config.style).toEqual({
      primaryColor: '#ff0055',
      position: 'bottom-left',
      darkMode: true,
      title: 'Support',
    });
  });

  it('omits the style object entirely when no override is present', () => {
    expect(configFromDataset({ agent: 'bot', host: 'https://acme.com' }).style).toBeUndefined();
  });

  it('ignores invalid enum values instead of rendering a broken layout', () => {
    const config = configFromDataset({ agent: 'bot', position: 'top-left', borderRadius: 'huge' });
    expect(config.style).toBeUndefined();
  });

  it('opens on load only for the exact string "true"', () => {
    expect(configFromDataset({ agent: 'b', open: 'true' }).defaultOpen).toBe(true);
    expect(configFromDataset({ agent: 'b', open: 'false' }).defaultOpen).toBeUndefined();
  });
});

describe('resolveStyle', () => {
  const serverConfig = {
    agentId: 'bot',
    name: 'Bot',
    status: 'ready',
    authMode: 'none',
    widgetStyle: { ...FALLBACK_STYLE, primaryColor: '#00aa88', title: 'Acme Support' },
  } satisfies PublicAgentConfig;

  it('uses the fallback style when the server config is unavailable', () => {
    expect(resolveStyle(null, undefined)).toEqual(FALLBACK_STYLE);
  });

  it('prefers the agent dashboard style over the fallback', () => {
    expect(resolveStyle(serverConfig, undefined).primaryColor).toBe('#00aa88');
  });

  it('lets embedder overrides win over the dashboard style', () => {
    const style = resolveStyle(serverConfig, { primaryColor: '#ff0000' });
    expect(style.primaryColor).toBe('#ff0000');
    expect(style.title).toBe('Acme Support');
  });
});

describe('resolveConfig', () => {
  it('returns a complete config', () => {
    expect(resolveConfig({ agentId: ' bot ', host: 'https://acme.com/' })).toMatchObject({
      agentId: 'bot',
      host: 'https://acme.com',
    });
  });

  it('throws an actionable error when the agent id is missing', () => {
    expect(() => resolveConfig({ host: 'https://acme.com' })).toThrow(/data-agent/);
  });

  it('throws an actionable error when the host is missing', () => {
    expect(() => resolveConfig({ agentId: 'bot' })).toThrow(/data-host/);
  });
});
