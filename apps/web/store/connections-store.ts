import { create } from 'zustand';
import { mutate as globalMutate } from 'swr';
import { toast } from 'sonner';
import type { ChannelSummary } from '@larkup/connections';
import { readDeploymentApiKey } from '@/lib/deployments';

const LOCAL_SERVER_KEY_STORAGE = 'larkup-server-api-key';
const MASKED = '••••••••';

export interface ConnectionRecord {
  id: string;
  enabled: boolean;
  /** OAuth connections rely on the managed proxy for inbound signature verification. */
  managed?: boolean;
  settings: Record<string, string>;
  target: { mode: 'local' | 'remote'; endpoint: string; apiKey?: string };
  provider?: { identity?: string; externalId?: string; testUrl?: string; testUrlLabel?: string };
}

/** One selectable entry in the "Agent target" dropdown — the local runtime or one deployed Agent Server. */
export interface AgentTarget {
  key: string;
  mode: 'local' | 'remote';
  label: string;
  endpoint: string;
  sublabel: string;
  icon?: string;
  deploymentId?: string;
}

function localServerApiKey() {
  return typeof window === 'undefined'
    ? ''
    : window.localStorage.getItem(LOCAL_SERVER_KEY_STORAGE) ?? '';
}

function autoloadApiKey(target: AgentTarget) {
  if (target.mode === 'local') return localServerApiKey();
  return (target.deploymentId && readDeploymentApiKey(target.deploymentId)) || '';
}

/** A masked secret is a display-only sentinel, not a real value — blank the
 * field instead of dumping literal dots into it. The "Saved" placeholder
 * (driven by `current`, which still holds the mask) tells the operator a
 * value already exists without ever showing it back to them. */
function blankMaskedValues(settings: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [key, value === MASKED ? '' : value]),
  );
}

export interface WebhookRegistration {
  ok: boolean;
  detail: string;
}

interface ConnectionFormState {
  active: ChannelSummary | null;
  current: ConnectionRecord | undefined;
  settings: Record<string, string>;
  /** Per-field secret visibility, keyed by configField.key — independent of `showApiKey`. */
  visibleFields: Record<string, boolean>;
  mode: 'local' | 'remote';
  targetKey: string;
  endpoint: string;
  apiKey: string;
  showApiKey: boolean;
  enabled: boolean;
  managed: boolean;
  saving: boolean;
  removing: boolean;
  testing: boolean;
  /** Result of telling the provider where to send updates, set right after a successful save. */
  webhookRegistration: WebhookRegistration | null;
}

interface ConnectionFormActions {
  /** Opens the sheet for a channel, seeding the form from its saved connection (if any). */
  open: (
    channel: ChannelSummary,
    current: ConnectionRecord | undefined,
    targets: AgentTarget[],
    localEndpoint: string,
  ) => void;
  close: () => void;
  selectTarget: (target: AgentTarget) => void;
  setEndpoint: (endpoint: string) => void;
  setApiKey: (apiKey: string) => void;
  toggleShowApiKey: () => void;
  setFieldValue: (key: string, value: string) => void;
  /** Fills a field with a random string — for any `configField.canGenerate` secret. */
  generateFieldValue: (key: string) => void;
  toggleFieldVisibility: (key: string) => void;
  setEnabled: (enabled: boolean) => void;
  setManaged: (managed: boolean) => void;
  applyManagedOAuth: (fields: Record<string, string>) => Promise<void>;
  save: () => Promise<void>;
  remove: () => Promise<void>;
  test: () => Promise<void>;
}

const CONNECTIONS_KEY = '/api/connections';

export const useConnectionFormStore = create<ConnectionFormState & ConnectionFormActions>()(
  (set, get) => ({
    active: null,
    current: undefined,
    settings: {},
    visibleFields: {},
    mode: 'local',
    targetKey: 'local',
    endpoint: '',
    apiKey: '',
    showApiKey: false,
    enabled: true,
    managed: false,
    saving: false,
    removing: false,
    testing: false,
    webhookRegistration: null,

    open: (channel, current, targets, localEndpoint) => {
      const savedMode = current?.target.mode ?? 'local';
      const savedEndpoint = current?.target.endpoint ?? localEndpoint;
      const matched =
        savedMode === 'remote'
          ? targets.find((target) => target.mode === 'remote' && target.endpoint === savedEndpoint)
          : targets[0];
      set({
        active: channel,
        current,
        settings: blankMaskedValues(current?.settings ?? {}),
        visibleFields: {},
        enabled: current?.enabled ?? true,
        managed: current?.managed ?? false,
        showApiKey: false,
        webhookRegistration: null,
        mode: savedMode,
        endpoint: savedEndpoint,
        targetKey: matched?.key ?? 'local',
        apiKey:
          current?.target.apiKey === MASKED ? '' : current?.target.apiKey ?? localServerApiKey(),
      });
    },

    close: () => set({ active: null, current: undefined, webhookRegistration: null }),

    selectTarget: (target) =>
      set({
        targetKey: target.key,
        mode: target.mode,
        endpoint: target.endpoint,
        apiKey: autoloadApiKey(target),
      }),

    setEndpoint: (endpoint) => set({ endpoint }),
    setApiKey: (apiKey) => set({ apiKey }),
    toggleShowApiKey: () => set((state) => ({ showApiKey: !state.showApiKey })),
    setFieldValue: (key, value) =>
      set((state) => ({ settings: { ...state.settings, [key]: value } })),
    generateFieldValue: (key) => {
      const value = Array.from({ length: 2 }, () => Math.random().toString(36).slice(2, 15)).join(
        '',
      );
      set((state) => ({
        settings: { ...state.settings, [key]: value },
        visibleFields: { ...state.visibleFields, [key]: true },
      }));
    },
    toggleFieldVisibility: (key) =>
      set((state) => ({
        visibleFields: { ...state.visibleFields, [key]: !state.visibleFields[key] },
      })),
    setEnabled: (enabled) => set({ enabled }),
    setManaged: (managed) => set({ managed }),
    applyManagedOAuth: async (fields) => {
      set((state) => ({
        settings: { ...state.settings, ...fields },
        managed: true,
      }));
      await get().save();
    },

    save: async () => {
      const { active, current, enabled, managed, settings, mode, endpoint, apiKey } = get();
      if (!active) return;
      set({ saving: true, webhookRegistration: null });
      try {
        const response = await fetch(CONNECTIONS_KEY, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: active.id,
            enabled,
            managed,
            settings,
            target: { mode, endpoint, apiKey: apiKey || current?.target.apiKey },
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Could not save the channel.');
        await globalMutate(CONNECTIONS_KEY);
        toast.success(`${active.name} is connected to this Agent.`, { position: 'bottom-left' });
        // Stay open and re-seed from the saved record instead of closing —
        // the webhook URL and "go live" status below are exactly what an
        // operator needs to see right after saving, not something to hunt
        // for by reopening the sheet.
        const saved: ConnectionRecord = result.connection;
        set({
          current: saved,
          settings: blankMaskedValues(saved.settings),
          apiKey: saved.target.apiKey === MASKED ? '' : apiKey,
          webhookRegistration: result.webhookRegistration ?? null,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not save the channel.', {
          position: 'bottom-left',
        });
      } finally {
        set({ saving: false });
      }
    },

    remove: async () => {
      const { active } = get();
      if (!active) return;
      set({ removing: true });
      try {
        const response = await fetch(`${CONNECTIONS_KEY}/${active.id}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Could not remove the connection.');
        await globalMutate(CONNECTIONS_KEY);
        toast.success(`${active.name} was disconnected.`, { position: 'bottom-left' });
        get().close();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not remove the connection.', {
          position: 'bottom-left',
        });
      } finally {
        set({ removing: false });
      }
    },

    test: async () => {
      const { active, current, settings, mode, endpoint, apiKey, managed } = get();
      if (!active) return;
      set({ testing: true });
      try {
        const response = await fetch(CONNECTIONS_KEY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: active.id,
            managed,
            settings,
            target: { mode, endpoint, apiKey: apiKey || current?.target.apiKey },
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Could not test this channel.');
        if (result.channel.status !== 'ok') throw new Error(result.channel.detail);
        if (!result.runtime.ok)
          throw new Error('The selected endpoint is not a reachable Agent Server.');
        toast.success(`${result.channel.detail} Agent: ${result.runtime.name}.`, {
          position: 'bottom-left',
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not test this channel.', {
          position: 'bottom-left',
        });
      } finally {
        set({ testing: false });
      }
    },
  }),
);
