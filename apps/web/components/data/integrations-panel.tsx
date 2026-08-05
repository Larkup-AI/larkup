'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { NotionPanel } from '@/components/data/notion-panel';
import { IntegrationResourcesPanel } from '@/components/data/integration-resources-panel';
import { useNotionAuth } from '@/hooks/use-notion-auth';
import { useIntegrationAuth } from '@/hooks/use-integration-auth';
import { integrations } from '@larkup/integrations';
import { cn } from '@/lib/utils';
import { CableIcon, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

const googleIntegrationsAwaitingVerification = new Set([
  'google-analytics',
  'google-calendar',
  'google-docs',
  'google-drive',
  'google-maps',
  'google-meet',
  'google-sheets',
  'google-slides',
]);

const hiddenIntegrationIds = new Set(['jira-data-center']);
const releasedIntegrationIds = new Set(['jira', 'linear']);

// The display policy lives here so a cached integration-package release cannot
// reintroduce retired cards or hide integrations that are live in the proxy.
// Google remains unavailable until its production OAuth verification is complete.
const panelIntegrations = integrations
  .filter((integration) => !hiddenIntegrationIds.has(integration.id))
  .map((integration) => {
    if (googleIntegrationsAwaitingVerification.has(integration.id)) {
      return { ...integration, status: 'coming-soon' as const };
    }

    if (releasedIntegrationIds.has(integration.id)) {
      return { ...integration, status: 'ready' as const };
    }

    return integration;
  });

export function IntegrationsPanel({ onAdded }: { onAdded: () => void }) {
  const [activeIntegration, setActiveIntegration] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const {
    data: connectionData,
    isLoading: isLoadingStatus,
    mutate: mutateConnections,
  } = useSWR('/api/integrations', (url) => fetch(url).then((res) => res.json()));
  const connectedStatus = Object.fromEntries(
    (connectionData?.integrations ?? []).map((integration: { id: string; connected: boolean }) => [
      integration.id,
      integration.connected,
    ]),
  ) as Record<string, boolean>;
  const visibleIntegrations = useMemo(() => {
    const query = search.trim().toLowerCase();
    const priority = (integration: (typeof panelIntegrations)[number]) => {
      if (integration.status === 'ready' && connectedStatus[integration.id]) return 0;
      return integration.status === 'ready' ? 1 : 2;
    };

    return panelIntegrations
      .filter(
        (integration) =>
          !query || `${integration.name} ${integration.category}`.toLowerCase().includes(query),
      )
      .sort((left, right) => priority(left) - priority(right));
  }, [connectedStatus, search]);

  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [requestCompany, setRequestCompany] = useState('');
  const [requestEmail, setRequestEmail] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState(false);

  const handleRequestIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestEmail) return;

    setIsRequesting(true);
    try {
      const res = await fetch(
        process.env.NEXT_PUBLIC_CONNECT_API_URL || 'https://www.larkup.de/api/connect',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: requestName,
            company: requestCompany,
            email: requestEmail,
            message: requestMessage,
          }),
        },
      );

      if (!res.ok) {
        throw new Error('Failed to send request');
      }

      setRequestSuccess(true);
      toast.success('Request sent successfully!');

      setTimeout(() => {
        setIsRequestModalOpen(false);
        setRequestSuccess(false);
        setRequestName('');
        setRequestCompany('');
        setRequestEmail('');
        setRequestMessage('');
      }, 2000);
    } catch (error) {
      toast.error('Failed to send request. Please try again later.');
    } finally {
      setIsRequesting(false);
    }
  };

  const fetchStatuses = () => {
    mutateConnections();
  };

  const { connectToNotion: handleConnectNotion } = useNotionAuth({
    onSuccess: () => {
      fetchStatuses();
      toast.success('Successfully connected to Notion');
    },
    onError: (error) => {
      toast.error(error);
    },
  });
  const { connect: connectIntegration } = useIntegrationAuth({
    onSuccess: (integration) => {
      fetchStatuses();
      const name = panelIntegrations.find((item) => item.id === integration)?.name ?? 'integration';
      toast.success(`Successfully connected to ${name}`);
    },
    onError: (error) => toast.error(error),
  });

  return (
    <div className="space-y-6 pb-9">
      <div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search integrations"
              placeholder="Search integrations..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 bg-background pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2 bg-white/80 hover:bg-white"
            onClick={() => setIsRequestModalOpen(true)}
          >
            <CableIcon className="size-3.5" />
            Ask for integration
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {visibleIntegrations.map((integration) => {
            const isConnected = connectedStatus[integration.id];

            return (
              <div
                key={integration.id}
                data-testid="integration-card"
                data-integration-id={integration.id}
                className={cn(
                  'group flex items-center justify-between gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-all',
                  integration.status === 'ready'
                    ? 'border-border bg-white/80 hover:border-primary/20 hover:bg-white'
                    : 'border-border/60 bg-muted/15',
                )}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/30">
                    <img
                      src={integration.icon}
                      alt={integration.name}
                      className="size-6 object-contain"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {integration.name}
                      </span>
                      <span className="text-[10px] font-medium text-muted-foreground/70">
                        {integration.category}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-50">
                      {integration.description}
                    </p>
                  </div>
                </div>

                <div className="shrink-0">
                  {integration.status === 'coming-soon' ? (
                    <span className="rounded-md border border-border/70 bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
                      Coming soon
                    </span>
                  ) : isLoadingStatus ? (
                    <Button variant="outline" size="sm" className="h-8 w-21" disabled>
                      <Loader2 className="size-3.5 animate-spin" />
                    </Button>
                  ) : isConnected ? (
                    <Button
                      variant="default"
                      size="sm"
                      className="h-8 w-21"
                      onClick={() => setActiveIntegration(integration.id)}
                    >
                      Configure
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-21 bg-muted/50 hover:bg-muted/80 "
                      onClick={() =>
                        integration.id === 'notion'
                          ? handleConnectNotion()
                          : connectIntegration(integration.id)
                      }
                    >
                      Connect
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {search.trim() &&
          !panelIntegrations.some((integration) =>
            `${integration.name} ${integration.category}`
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
          ) && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No integrations match “{search.trim()}”.
            </p>
          )}
      </div>

      <Dialog
        open={!!activeIntegration}
        onOpenChange={(open) => {
          if (!open) {
            setActiveIntegration(null);
            // Re-fetch status when closing modal to update UI
            if (activeIntegration === 'notion') {
              mutateConnections();
            }
          }
        }}
      >
        <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Integration Panel</DialogTitle>
          </DialogHeader>
          {activeIntegration === 'notion' && (
            <NotionPanel onAdded={onAdded} onClose={() => setActiveIntegration(null)} />
          )}
          {activeIntegration &&
            activeIntegration !== 'notion' &&
            (() => {
              const integration = panelIntegrations.find(
                (item) => item.id === activeIntegration && item.status === 'ready',
              );
              return integration ? (
                <IntegrationResourcesPanel
                  integration={integration.id}
                  name={integration.name}
                  icon={integration.icon}
                  onAdded={onAdded}
                  onClose={() => {
                    setActiveIntegration(null);
                    mutateConnections();
                  }}
                />
              ) : null;
            })()}
        </DialogContent>
      </Dialog>

      <Dialog open={isRequestModalOpen} onOpenChange={setIsRequestModalOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Ask for Integration</DialogTitle>
          </DialogHeader>
          {requestSuccess ? (
            <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="text-sm text-muted-foreground">
                Thank you! We've received your request and will get back to you soon.
              </p>
            </div>
          ) : (
            <form onSubmit={handleRequestIntegration} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="John Doe"
                    value={requestName}
                    onChange={(e) => setRequestName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company">Company</Label>
                  <Input
                    id="company"
                    type="text"
                    placeholder="Acme Inc."
                    value={requestCompany}
                    onChange={(e) => setRequestCompany(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">
                  Your Email <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={requestEmail}
                  onChange={(e) => setRequestEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">Which integration do you need?</Label>
                <Textarea
                  id="message"
                  placeholder="Tell us which tool you want to connect and how you plan to use it..."
                  className="resize-none min-h-30 max-h-67.5!"
                  rows={5}
                  value={requestMessage}
                  onChange={(e) => setRequestMessage(e.target.value)}
                />
              </div>
              <DialogFooter className="bg-muted/50 border-border/70 mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsRequestModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isRequesting}>
                  {isRequesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Submit Request
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
