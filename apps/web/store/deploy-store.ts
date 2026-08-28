import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Persisted deployment credentials.

interface PersistedCredentials {
  vercelToken: string;
  vercelProject: string;
  // SSH credentials keyed by provider.
  sshCredentials: Record<
    string,
    { host: string; username: string; authType: 'key' | 'password'; credential: string }
  >;
  deployStorage: {
    storeId?: string;
    storeConfig?: Record<string, string>;
    embeddingModelId?: string;
  };
}

interface PersistedActions {
  setVercelToken: (token: string) => void;
  setVercelProject: (project: string) => void;
  setSshCredential: (
    provider: string,
    cred: { host: string; username: string; authType: 'key' | 'password'; credential: string },
  ) => void;
  setDeployStorage: (storage: Partial<PersistedCredentials['deployStorage']>) => void;
}

export const useDeployCredentialsStore = create<PersistedCredentials & PersistedActions>()(
  persist(
    (set) => ({
      vercelToken: '',
      vercelProject: '',
      sshCredentials: {},
      deployStorage: {},

      setVercelToken: (token) => set({ vercelToken: token }),
      setVercelProject: (project) => set({ vercelProject: project }),
      setSshCredential: (provider, cred) =>
        set((prev) => ({
          sshCredentials: { ...prev.sshCredentials, [provider]: cred },
        })),
      setDeployStorage: (storage) =>
        set((prev) => ({
          deployStorage: { ...prev.deployStorage, ...storage },
        })),
    }),
    {
      name: 'larkup-deploy-credentials',
    },
  ),
);

// Ephemeral VPS terminal state; intentionally not persisted.

export type VpsTerminalState = 'deploying' | 'password_required' | 'success' | 'error';

interface VpsTerminalStore {
  open: boolean;
  logs: string[];
  state: VpsTerminalState;
  url?: string;
  error?: string;

  openTerminal: () => void;
  closeTerminal: () => void;
  reset: () => void;
  appendLog: (line: string) => void;
  setState: (state: VpsTerminalState) => void;
  setUrl: (url: string) => void;
  setError: (error: string) => void;
}

export const useVpsTerminalStore = create<VpsTerminalStore>()((set) => ({
  open: false,
  logs: [],
  state: 'deploying',
  url: undefined,
  error: undefined,

  openTerminal: () => set({ open: true }),
  closeTerminal: () => set({ open: false }),
  reset: () => set({ logs: [], state: 'deploying', url: undefined, error: undefined }),
  appendLog: (line) => set((prev) => ({ logs: [...prev.logs, line] })),
  setState: (state) => set({ state }),
  setUrl: (url) => set({ url }),
  setError: (error) => set({ error }),
}));
