import { useCallback } from 'react';
import { useVpsTerminalStore } from '@/store/deploy-store';
import { saveDeploymentApiKey } from '@/lib/deployments';

export interface VpsDeployPayload {
  provider: string;
  profile: 'knowledge' | 'assistant';
  assistantOptions?: {
    systemPrompt?: string;
    enabledTools?: string[];
    enabledMcp?: string[];
    enabledSkills?: string[];
    enabledPlugins?: string[];
    sandboxProvider?: string;
  };
  deployConfig: {
    vectorStore: string;
    storeConfig: Record<string, string>;
    embeddingModelId: string;
    chatProvider?: string;
    chatModelId?: string;
    chatApiKey?: string;
    saveStorageSettings?: boolean;
    envValues?: Record<string, string>;
    apiKey?: string;
    credentials: {
      sshHost: string;
      sshUsername: string;
      sshAuthType: 'key' | 'password';
      sshKeyOrPassword: string;
      newPassword?: string;
    };
  };
}

/**
 * Drives the VPS terminal dialog by consuming the streaming SSE response
 * from /api/deploy/ssh and updating the Zustand store on each event.
 */
export function useVpsDeploy(onSaved: () => void, onDeployed?: () => void) {
  const terminal = useVpsTerminalStore();

  const deployToVps = useCallback(
    async (payload: VpsDeployPayload) => {
      terminal.reset();
      terminal.openTerminal();
      terminal.setState('deploying');

      try {
        const response = await fetch('/api/deploy/ssh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.body) throw new Error('No response stream from server.');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            if (!part.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(part.slice(6));
              switch (data.type) {
                case 'log':
                  terminal.appendLog(data.message);
                  break;
                case 'password_change_required':
                  terminal.setState('password_required');
                  // Stream pauses here — resumed by onPasswordSubmit
                  return;
                case 'password_changed':
                  terminal.appendLog('--- Password changed. Reconnecting... ---');
                  break;
                case 'done':
                  if (data.success) {
                    if (payload.deployConfig.apiKey && data.deploymentId) {
                      saveDeploymentApiKey(data.deploymentId, payload.deployConfig.apiKey);
                    }
                    terminal.setUrl(data.url);
                    terminal.setState('success');
                    onSaved();
                  }
                  break;
                case 'error':
                  terminal.setError(data.error || 'Deployment failed.');
                  terminal.setState('error');
                  break;
              }
            } catch {
              // malformed SSE frame — skip
            }
          }
        }
      } catch (err: any) {
        terminal.setError(err?.message || 'Deployment failed.');
        terminal.setState('error');
      }
    },
    [terminal, onSaved],
  );

  return { deployToVps };
}
