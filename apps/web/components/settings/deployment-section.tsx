'use client';

import { useState, useEffect } from 'react';
import { Play, Square, Code, ExternalLink, Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import type { AgentDeploymentConfig } from '@larkup/core/types';
import type { LocalServerState } from '@larkup/core/generator/server-runtime';

export function DeploymentSection() {
  const [config, setConfig] = useState<AgentDeploymentConfig | null>(null);
  const [serverState, setServerState] = useState<LocalServerState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);
  const [blobToken, setBlobToken] = useState('');
  const [isBlobConnected, setIsBlobConnected] = useState(false);

  useEffect(() => {
    fetchConfig();
    fetchServerState();
    fetchBlobState();
  }, []);

  async function fetchConfig() {
    try {
      const res = await fetch('/api/deployment/config');
      const data = await res.json();
      if (!data.error) setConfig(data);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchServerState() {
    const res = await fetch('/api/server/agent');
    if (res.ok) {
      setServerState(await res.json());
    }
  }

  async function fetchBlobState() {
    const res = await fetch('/api/deployment/blob-setup');
    if (res.ok) {
      const { connected } = await res.json();
      setIsBlobConnected(connected);
    }
  }

  async function saveConfig(updates: Partial<AgentDeploymentConfig>) {
    if (!config) return;
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    await fetch('/api/deployment/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
    });
    toast.success('Deployment settings saved');
  }

  async function connectBlob() {
    const res = await fetch('/api/deployment/blob-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: blobToken }),
    });
    if (res.ok) {
      toast.success('Vercel Blob connected');
      setIsBlobConnected(true);
      setBlobToken('');
    } else {
      toast.error('Failed to connect Vercel Blob');
    }
  }

  async function toggleServer() {
    if (serverState?.running) {
      setIsDeploying(true);
      const res = await fetch('/api/server/agent', { method: 'DELETE' });
      if (res.ok) setServerState(await res.json());
      setIsDeploying(false);
    } else {
      setIsDeploying(true);
      const res = await fetch('/api/server/agent', { method: 'POST' });
      if (res.ok) setServerState(await res.json());
      setIsDeploying(false);
    }
  }

  const copyWidgetCode = () => {
    const code = `<script src="http://localhost:8081/widget.js"></script>`;
    navigator.clipboard.writeText(code);
    toast.success('Widget code copied to clipboard');
  };

  const copyShareLink = () => {
    const url = 'http://localhost:8081/chat-ui';
    navigator.clipboard.writeText(url);
    toast.success('Share link copied to clipboard');
  };

  if (isLoading || !config) {
    return (
      <div className="p-8 text-center text-muted-foreground">Loading deployment config...</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Deploy & Share Agent</h2>
          <p className="text-sm text-muted-foreground">
            Configure how your agent is deployed, shared, and embedded in external websites.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Agent Type</CardTitle>
            <CardDescription className="text-xs">Choose the type of deployment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Deployment Type</Label>
              <Select
                value={config.type || ''}
                onValueChange={(val: any) => saveConfig({ type: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rag-only">RAG Only (API Backend)</SelectItem>
                  <SelectItem value="full-agent">Full Agent (Chat UI & Widget)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {config.type === 'full-agent' && (
              <div className="space-y-2">
                <Label htmlFor="system-prompt">System Prompt</Label>
                <Textarea
                  id="system-prompt"
                  placeholder="You are a helpful AI..."
                  value={config.systemPrompt || ''}
                  onChange={(e) => saveConfig({ systemPrompt: e.target.value })}
                  rows={3}
                  className="resize-none"
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Authentication</CardTitle>
            <CardDescription className="text-xs">Control who can access your agent</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Auth Mode</Label>
              <Select
                value={config.authMode || ''}
                onValueChange={(val: any) => saveConfig({ authMode: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Public (No Auth)</SelectItem>
                  <SelectItem value="api-key">API Key (Server to Server)</SelectItem>
                  <SelectItem value="join-code">Join Code (For Users)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {config.authMode === 'join-code' && (
              <div className="space-y-2">
                <Label htmlFor="join-code">Join Code</Label>
                <Input
                  id="join-code"
                  placeholder="e.g. secret-beta-code"
                  value={config.joinCode || ''}
                  onChange={(e) => saveConfig({ joinCode: e.target.value })}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {config.type === 'full-agent' && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Widget Customization</CardTitle>
              <CardDescription className="text-xs">
                Customize the appearance of the embeddable chat widget
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="primary-color">Primary Color</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={config.widgetStyle.primaryColor}
                      onChange={(e) =>
                        saveConfig({
                          widgetStyle: { ...config.widgetStyle, primaryColor: e.target.value },
                        })
                      }
                      className="w-12 h-10 p-1 cursor-pointer"
                    />
                    <Input
                      id="primary-color"
                      value={config.widgetStyle.primaryColor}
                      onChange={(e) =>
                        saveConfig({
                          widgetStyle: { ...config.widgetStyle, primaryColor: e.target.value },
                        })
                      }
                      className="font-mono flex-1"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Position</Label>
                  <Select
                    value={config.widgetStyle.position || ''}
                    onValueChange={(val: any) =>
                      saveConfig({ widgetStyle: { ...config.widgetStyle, position: val } })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bottom-right">Bottom Right</SelectItem>
                      <SelectItem value="bottom-left">Bottom Left</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Widget Title</Label>
                  <Input
                    value={config.widgetStyle.title}
                    onChange={(e) =>
                      saveConfig({ widgetStyle: { ...config.widgetStyle, title: e.target.value } })
                    }
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Welcome Message</Label>
                  <Input
                    value={config.widgetStyle.welcomeMessage}
                    onChange={(e) =>
                      saveConfig({
                        widgetStyle: { ...config.widgetStyle, welcomeMessage: e.target.value },
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label>Input Placeholder</Label>
                  <Input
                    value={config.widgetStyle.placeholder}
                    onChange={(e) =>
                      saveConfig({
                        widgetStyle: { ...config.widgetStyle, placeholder: e.target.value },
                      })
                    }
                  />
                </div>

                <div className="flex items-center justify-between pt-4">
                  <Label className="flex flex-col gap-1">
                    <span>Dark Mode</span>
                    <span className="font-normal text-sm text-muted-foreground">
                      Force dark mode for the widget
                    </span>
                  </Label>
                  <Switch
                    checked={config.widgetStyle.darkMode}
                    onCheckedChange={(val) =>
                      saveConfig({ widgetStyle: { ...config.widgetStyle, darkMode: val } })
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Cloud Storage Setup</CardTitle>
          <CardDescription className="text-xs">
            Use Vercel Blob for original files and media. Configure a cloud vector store separately
            for retrieval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isBlobConnected ? (
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-md">
              <Check className="w-5 h-5" /> Vercel Blob is connected for media and file storage.
            </div>
          ) : (
            <div className="space-y-3 max-w-lg">
              <a
                href="https://vercel.com/integrations/vercel-blob"
                target="_blank"
                rel="noreferrer"
                className="inline-flex text-sm font-medium underline underline-offset-4"
              >
                Install Vercel Blob in your Vercel account
              </a>
              <p className="text-xs text-muted-foreground">
                After installation, paste the Blob read/write token to connect this workspace.
              </p>
              <div className="flex items-end gap-3">
                <div className="space-y-2 flex-1">
                  <Label>Vercel Blob Read/Write Token</Label>
                  <Input
                    type="password"
                    placeholder="vercel_blob_rw_..."
                    value={blobToken}
                    onChange={(e) => setBlobToken(e.target.value)}
                  />
                </div>
                <Button onClick={connectBlob} disabled={!blobToken}>
                  Connect
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-8 pt-8 border-t border-border/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <h3 className="text-lg font-medium mb-1">Local Test Server</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Start the agent server locally to test your chat UI and widget configuration.
          </p>
          <div className="flex items-center gap-3">
            <Button
              onClick={toggleServer}
              disabled={isDeploying}
              variant={serverState?.running ? 'destructive' : 'default'}
              className="w-32"
            >
              {isDeploying ? (
                'Working...'
              ) : serverState?.running ? (
                <>
                  <Square className="w-4 h-4 mr-2" /> Stop Agent
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" /> Start Agent
                </>
              )}
            </Button>

            {serverState?.running && (
              <span className="text-sm font-medium text-emerald-600 flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                Agent Running on port 8081
              </span>
            )}
          </div>
        </div>

        {serverState?.running && config.type === 'full-agent' && (
          <div className="flex flex-col gap-3 min-w-[280px]">
            <Button variant="outline" className="justify-between" onClick={copyShareLink}>
              <span className="flex items-center gap-2">
                <ExternalLink className="w-4 h-4" /> Share Link
              </span>
              <Copy className="w-4 h-4 text-muted-foreground" />
            </Button>
            <Button
              variant="outline"
              className="justify-between bg-primary/5 hover:bg-primary/10 border-primary/20"
              onClick={copyWidgetCode}
            >
              <span className="flex items-center gap-2">
                <Code className="w-4 h-4 text-primary" /> Copy Embed Code
              </span>
              <Copy className="w-4 h-4 text-primary/70" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
