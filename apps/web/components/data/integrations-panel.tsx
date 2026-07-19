"use client";

import { useState, useEffect } from "react";
import { NotionPanel } from "@/components/data/notion-panel";
import { cn } from "@/lib/utils";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

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
    id: "notion",
    name: "Notion",
    category: "Documentation",
    description: "Pages, docs, and knowledge bases.",
    icon: "/notion.png",
    available: true,
  },
  {
    id: "google-drive",
    name: "Google Drive",
    category: "Documentation",
    description: "Files, folders, and shared drives.",
    icon: "/icons/google-drive.png",
    available: false,
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    category: "Communication",
    description: "Events, schedules, and meetings.",
    icon: "/icons/google-calender.png",
    available: false,
  },
  {
    id: "slack",
    name: "Slack",
    category: "Communication",
    description: "Channels, messages, and DMs.",
    icon: "/icons/slack.png",
    available: false,
  },
  {
    id: "salesforce",
    name: "Salesforce",
    category: "CRM",
    description: "Accounts, contacts, and opportunities.",
    icon: "/icons/Salesforce.png",
    available: false,
  },
  {
    id: "linear",
    name: "Linear",
    category: "Project Management",
    description: "Issues, projects, and roadmaps.",
    icon: "/icons/linear.png",
    available: false,
  },
  {
    id: "jira",
    name: "Jira",
    category: "Project Management",
    description: "Issues, sprints, and projects.",
    icon: "/icons/jira.png",
    available: false,
  },
  {
    id: "confluence",
    name: "Confluence",
    category: "Documentation",
    description: "Pages, spaces, and knowledge bases.",
    icon: "/icons/Confluence.png",
    available: false,
  },
  {
    id: "sharepoint",
    name: "SharePoint",
    category: "Documentation",
    description: "Sites, lists, and document libraries.",
    icon: "/icons/sharepoint.png",
    available: false,
  },
  {
    id: "sap",
    name: "SAP",
    category: "ERP",
    description: "Business processes, data, and analytics.",
    icon: "/icons/sap.png",
    available: false,
  },
  {
    id: "outlook",
    name: "Outlook",
    category: "Communication",
    description: "Emails, contacts, and calendars.",
    icon: "/icons/outlook.png",
    available: false,
  },
  {
    id: "onedrive",
    name: "OneDrive",
    category: "Documentation",
    description: "Files, folders, and shared drives.",
    icon: "/icons/onedrive.png",
    available: false,
  },
];

export function IntegrationsPanel({ onAdded }: { onAdded: () => void }) {
  const [activeIntegration, setActiveIntegration] = useState<string | null>(
    null,
  );
  const [connectedStatus, setConnectedStatus] = useState<
    Record<string, boolean>
  >({});

  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [requestEmail, setRequestEmail] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState(false);

  const handleRequestIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestEmail) return;

    setIsRequesting(true);
    try {
      const res = await fetch(
        process.env.NEXT_PUBLIC_CONNECT_API_URL || "https://www.larkup.de/api/connect",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        body: JSON.stringify({
          email: requestEmail,
          message: requestMessage,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to send request");
      }

      setRequestSuccess(true);
      toast.success("Request sent successfully!");

      setTimeout(() => {
        setIsRequestModalOpen(false);
        setRequestSuccess(false);
        setRequestEmail("");
        setRequestMessage("");
      }, 2000);
    } catch (error) {
      toast.error("Failed to send request. Please try again later.");
    } finally {
      setIsRequesting(false);
    }
  };

  const fetchStatuses = () => {
    fetch("/api/integrations/notion")
      .then((res) => res.json())
      .then((data) => {
        setConnectedStatus((prev) => ({ ...prev, notion: data.connected }));
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchStatuses();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "notion_oauth") {
        if (event.data.status === "connected") {
          fetchStatuses();
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleConnectNotion = () => {
    // Use the official Larkup Proxy by default, or an override if provided
    const customAuthUrl =
      process.env.NEXT_PUBLIC_NOTION_AUTHORIZATION_URL ||
      "https://larkup-proxy.vercel.app/api/oauth/notion";

    const redirectUri = `${window.location.origin}/api/integrations/notion/callback`;
    const authUrl = `${customAuthUrl}?redirect_to=${encodeURIComponent(redirectUri)}`;

    const width = 600;
    const height = 800;
    const left = window.innerWidth / 2 - width / 2 + window.screenX;
    const top = window.innerHeight / 2 - height / 2 + window.screenY;

    const popup = window.open(
      authUrl,
      "Notion Connection",
      `width=${width},height=${height},left=${left},top=${top},toolbar=0,scrollbars=1,status=1,resizable=1`,
    );

    if (popup) {
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          fetchStatuses();
        }
      }, 1000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Available integrations */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            Available Integrations
          </h3>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2 bg-white/80 hover:bg-white"
            onClick={() => setIsRequestModalOpen(true)}
          >
            <Sparkles className="size-3.5" />
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
                  "group flex items-center justify-between gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-all",
                  integration.available
                    ? "border-border bg-white/80 hover:border-primary/20 hover:bg-white"
                    : "border-border/40 opacity-60",
                )}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/50">
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
                    isConnected ? (
                      <Button
                        variant="default"
                        size="sm"
                        className="h-8"
                        onClick={() => setActiveIntegration(integration.id)}
                      >
                        Configure
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          if (integration.id === "notion") {
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
            if (activeIntegration === "notion") {
              fetch("/api/integrations/notion")
                .then((res) => res.json())
                .then((data) => {
                  setConnectedStatus((prev) => ({
                    ...prev,
                    notion: data.connected,
                  }));
                })
                .catch(() => {});
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Integration Panel</DialogTitle>
          </DialogHeader>
          {activeIntegration === "notion" && <NotionPanel onAdded={onAdded} />}
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
                Thank you! We've received your request and will get back to you
                soon.
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleRequestIntegration}
              className="space-y-4 mt-4"
            >
              <div className="space-y-2">
                <Label htmlFor="email">Your Email *</Label>
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
              <Button type="submit" className="w-full" disabled={isRequesting}>
                {isRequesting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Submit Request
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
