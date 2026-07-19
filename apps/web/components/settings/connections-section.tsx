"use client";

import { useState } from "react";
import { Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ConnectionId =
  | "webhook"
  | "slack"
  | "discord"
  | "telegram"
  | "whatsapp"
  | "widget";

interface ConnectionItem {
  id: ConnectionId;
  name: string;
  description: string;
  iconPath?: string;
  IconComponent?: any;
  fields: { id: string; label: string; type: string; placeholder: string }[];
}

const CONNECTIONS: ConnectionItem[] = [
  {
    id: "webhook",
    name: "Webhook",
    description: "Custom webhook integration",
    iconPath: "/icons/webhook.png",
    fields: [
      {
        id: "url",
        label: "Webhook URL",
        type: "url",
        placeholder: "https://your-domain.com/webhook",
      },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Connect to a Slack workspace",
    iconPath: "/icons/slack.png",
    fields: [
      {
        id: "token",
        label: "Bot User OAuth Token",
        type: "password",
        placeholder: "xoxb-...",
      },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    description: "Add a Discord bot",
    iconPath: "/icons/discord.png",
    fields: [
      {
        id: "token",
        label: "Bot Token",
        type: "password",
        placeholder: "Paste your Discord bot token",
      },
    ],
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Create a Telegram bot",
    iconPath: "/icons/telegram.png",
    fields: [
      {
        id: "token",
        label: "Bot Token",
        type: "password",
        placeholder: "Paste your Telegram bot token from BotFather",
      },
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "WhatsApp Business API",
    iconPath: "/icons/whatsapp.png",
    fields: [
      {
        id: "phoneNumberId",
        label: "Phone Number ID",
        type: "text",
        placeholder: "e.g. 10123456789",
      },
      {
        id: "token",
        label: "Access Token",
        type: "password",
        placeholder: "Permanent or temporary access token",
      },
    ],
  },
  {
    id: "widget",
    name: "Website Widget",
    description: "Inject a chat UI in your website",
    IconComponent: Code2,
    fields: [
      {
        id: "domain",
        label: "Allowed Domain",
        type: "text",
        placeholder: "https://your-website.com",
      },
    ],
  },
];

export function ConnectionsSection() {
  const [connected, setConnected] = useState<Record<string, boolean>>({});

  // Dialog state
  const [activeDialog, setActiveDialog] = useState<ConnectionId | null>(null);
  const [dialogType, setDialogType] = useState<"connect" | "configure" | null>(
    null,
  );

  const handleConnectClick = (id: ConnectionId) => {
    setActiveDialog(id);
    setDialogType("connect");
  };

  const handleConfigureClick = (id: ConnectionId) => {
    setActiveDialog(id);
    setDialogType("configure");
  };

  const activeConnection = CONNECTIONS.find((c) => c.id === activeDialog);

  const handleSave = () => {
    if (activeDialog) {
      setConnected((prev) => ({ ...prev, [activeDialog]: true }));
      setActiveDialog(null);
    }
  };

  const handleDisconnect = () => {
    if (activeDialog) {
      setConnected((prev) => ({ ...prev, [activeDialog]: false }));
      setActiveDialog(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Connections</h2>
        <p className="text-sm text-muted-foreground">
          Connect different channels to your AI server to chat from anywhere.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-1 gap-5">
        {CONNECTIONS.map((conn) => {
          const isConnected = connected[conn.id];
          return (
            <div
              key={conn.id}
              className="group flex items-center justify-between gap-3.5 rounded-xl border border-border bg-card px-4 py-3.5 transition-all "
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/50 border border-border/30">
                  {conn.iconPath ? (
                    <img
                      src={conn.iconPath}
                      alt={conn.name}
                      className="size-6 object-contain"
                    />
                  ) : conn.IconComponent ? (
                    <conn.IconComponent className="size-5 text-foreground" />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {conn.name}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {conn.description}
                  </div>
                </div>
              </div>

              <div className="shrink-0">
                {isConnected ? (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8"
                    onClick={() => handleConfigureClick(conn.id)}
                  >
                    Configure
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => handleConnectClick(conn.id)}
                  >
                    Connect
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={!!activeDialog}
        onOpenChange={(open) => !open && setActiveDialog(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialogType === "connect"
                ? `Connect ${activeConnection?.name}`
                : `Configure ${activeConnection?.name}`}
            </DialogTitle>
            <DialogDescription>
              {dialogType === "connect"
                ? `Enter the required details to connect your ${activeConnection?.name} integration.`
                : `Manage your ${activeConnection?.name} integration settings.`}
            </DialogDescription>
          </DialogHeader>

          {dialogType === "connect" && activeConnection && (
            <div className="space-y-4 py-4">
              {activeConnection.fields.map((field) => (
                <div key={field.id} className="space-y-2">
                  <Label htmlFor={field.id}>{field.label}</Label>
                  <Input
                    id={field.id}
                    type={field.type}
                    placeholder={field.placeholder}
                  />
                </div>
              ))}

              {activeConnection.id === "widget" && (
                <div className="mt-4 p-4 bg-muted rounded-md border border-border">
                  <Label className="mb-2 block">Widget Code</Label>
                  <code className="text-xs text-muted-foreground break-all">
                    {`<script src="https://larkup.com/widget.js" data-token="YOUR_TOKEN"></script>`}
                  </code>
                </div>
              )}
            </div>
          )}

          {dialogType === "configure" && activeConnection && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg border border-border/50">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background border border-border">
                  {activeConnection.iconPath ? (
                    <img
                      src={activeConnection.iconPath}
                      alt={activeConnection.name}
                      className="size-6 object-contain"
                    />
                  ) : activeConnection.IconComponent ? (
                    <activeConnection.IconComponent className="size-5 text-foreground" />
                  ) : null}
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Status: Connected
                  </div>
                  <div className="text-xs text-green-600 flex items-center gap-1 mt-0.5">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                      <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                    </span>
                    Active and receiving messages
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {dialogType === "configure" ? (
              <div className="flex w-full justify-between items-center">
                <Button variant="destructive" onClick={handleDisconnect}>
                  Disconnect
                </Button>
                <Button variant="outline" onClick={() => setActiveDialog(null)}>
                  Close
                </Button>
              </div>
            ) : (
              <div className="flex w-full justify-end">
                <Button onClick={handleSave}>Save Connection</Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
