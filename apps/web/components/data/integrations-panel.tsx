"use client";

import { useState } from "react";
import { NotionPanel } from "@/components/data/notion-panel";
import { cn } from "@/lib/utils";
import { ChevronRight, ExternalLink } from "lucide-react";

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

  if (activeIntegration === "notion") {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setActiveIntegration(null)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Integrations
        </button>
        <NotionPanel onAdded={onAdded} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Available integrations */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-4">
          Available Integrations
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {INTEGRATIONS.map((integration) => (
            <button
              key={integration.id}
              type="button"
              disabled={!integration.available}
              onClick={() => {
                if (integration.available) {
                  setActiveIntegration(integration.id);
                }
              }}
              className={cn(
                "group flex items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-all",
                integration.available
                  ? "border-border bg-white/80  hover:border-primary/20 hover:bg-white cursor-pointer"
                  : "border-border/40 opacity-60 cursor-not-allowed",
              )}
            >
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
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {integration.description}
                </p>
              </div>
              {integration.available ? (
                <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground shrink-0 transition-colors" />
              ) : (
                <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded-md px-2 py-0.5 shrink-0">
                  Soon
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
