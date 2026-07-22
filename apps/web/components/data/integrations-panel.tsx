'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { NotionPanel } from '@/components/data/notion-panel';
import { useNotionAuth } from '@/hooks/use-notion-auth';
import { cn } from '@/lib/utils';
import { CableIcon } from 'lucide-react';
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

interface Integration {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  available: boolean;
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'notion',
    name: 'Notion',
    category: 'Documentation',
    description: 'Pages, docs, and knowledge bases.',
    icon: '/notion.png',
    available: true,
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    category: 'Documentation',
    description: 'Files, folders, and shared drives.',
    icon: '/icons/google-drive.png',
    available: false,
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'Communication',
    description: 'Events, schedules, and meetings.',
    icon: '/icons/google-calender.png',
    available: false,
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'Communication',
    description: 'Channels, messages, and DMs.',
    icon: '/icons/slack.png',
    available: false,
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'CRM',
    description: 'Accounts, contacts, and opportunities.',
    icon: '/icons/Salesforce.png',
    available: false,
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'Project Management',
    description: 'Issues, projects, and roadmaps.',
    icon: '/icons/linear.png',
    available: false,
  },
  {
    id: 'jira',
    name: 'Jira',
    category: 'Project Management',
    description: 'Issues, sprints, and projects.',
    icon: '/icons/jira.png',
    available: false,
  },
  {
    id: 'confluence',
    name: 'Confluence',
    category: 'Documentation',
    description: 'Pages, spaces, and knowledge bases.',
    icon: '/icons/Confluence.png',
    available: false,
  },
  {
    id: 'sharepoint',
    name: 'SharePoint',
    category: 'Documentation',
    description: 'Sites, lists, and document libraries.',
    icon: '/icons/sharepoint.png',
    available: false,
  },
  {
    id: 'sap',
    name: 'SAP',
    category: 'ERP',
    description: 'Business processes, data, and analytics.',
    icon: '/icons/sap.png',
    available: false,
  },
  {
    id: 'outlook',
    name: 'Outlook',
    category: 'Communication',
    description: 'Emails, contacts, and calendars.',
    icon: '/icons/outlook.png',
    available: false,
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    category: 'Documentation',
    description: 'Files, folders, and shared drives.',
    icon: '/icons/onedrive.png',
    available: false,
  },
];

export function IntegrationsPanel({ onAdded }: { onAdded: () => void }) {
  const [activeIntegration, setActiveIntegration] = useState<string | null>(null);

  const {
    data: notionData,
    isLoading: isNotionLoading,
    mutate: mutateNotion,
  } = useSWR('/api/integrations/notion', (url) => fetch(url).then((res) => res.json()));

  const connectedStatus: Record<string, boolean> = { notion: notionData?.connected ?? false };
  const isLoadingStatus = isNotionLoading && notionData === undefined;

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
    mutateNotion();
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

  return (
    <div className="space-y-6">
      {/* Available integrations */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Available Integrations</h3>
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
          {INTEGRATIONS.map((integration) => {
            const isConnected = connectedStatus[integration.id];

            return (
              <div
                key={integration.id}
                className={cn(
                  'group flex items-center justify-between gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-all',
                  integration.available
                    ? 'border-border bg-white/80 hover:border-primary/20 hover:bg-white'
                    : 'border-border/40 opacity-60',
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
                    <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">
                      {integration.description}
                    </p>
                  </div>
                </div>

                <div className="shrink-0">
                  {integration.available ? (
                    isLoadingStatus ? (
                      <Button variant="outline" size="sm" className="h-8 w-[84px]" disabled>
                        <Loader2 className="size-3.5 animate-spin" />
                      </Button>
                    ) : isConnected ? (
                      <Button
                        variant="default"
                        size="sm"
                        className="h-8 w-[84px]"
                        onClick={() => setActiveIntegration(integration.id)}
                      >
                        Configure
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-[84px]"
                        onClick={() => {
                          if (integration.id === 'notion') {
                            handleConnectNotion();
                          } else {
                            setActiveIntegration(integration.id);
                          }
                        }}
                      >
                        Connect
                      </Button>
                    )
                  ) : (
                    <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded-md px-2 py-0.5 shrink-0">
                      Soon
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog
        open={!!activeIntegration}
        onOpenChange={(open) => {
          if (!open) {
            setActiveIntegration(null);
            // Re-fetch status when closing modal to update UI
            if (activeIntegration === 'notion') {
              mutateNotion();
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Integration Panel</DialogTitle>
          </DialogHeader>
          {activeIntegration === 'notion' && (
            <NotionPanel onAdded={onAdded} onClose={() => setActiveIntegration(null)} />
          )}
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
                  className="resize-none min-h-[120px] max-h-[270px]!"
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
