"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import { ExternalLink, Globe, Server, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import {
  ConfigureForm,
  type ConfigureFormHandle,
} from "@/components/configure/configure-form";
import { SdkConnectDialog } from "@/components/simple/sdk-connect-dialog";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function SimpleSettingsPage() {
  const { activeServer } = useWorkspace();
  const serverId = activeServer?.id;
  const [handle, setHandle] = useState<ConfigureFormHandle | null>(null);

  const onHandleReady = useCallback((h: ConfigureFormHandle) => {
    setHandle({ ...h });
  }, []);

  const dirty = handle?.dirty ?? false;
  const saving = handle?.saving ?? false;

  // Get server status
  const endpoint = activeServer?.endpoint || "";
  const running = activeServer?.running || false;

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 md:px-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure your RAG pipeline, provider, and connect via SDK.
          </p>
        </div>
        <Button
          size="lg"
          variant="default"
          disabled={saving || !dirty}
          onClick={() => handle?.requestSave()}
          className="min-w-[110px] px-3.5 h-9.5 rounded-md transition-all text-white/90 text-[13px]"
        >
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="size-4" />
              Save Configuration
            </>
          )}
        </Button>
      </div>

      {/* Server Info + SDK Connect */}
      <div className="px-6 pb-4 md:px-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="size-4 text-primary" />
              RAG Server
            </CardTitle>
            <CardDescription className="text-xs">
              Your server&apos;s status and connection details.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Server status */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Status:</span>
                {running ? (
                  <Badge
                    variant="default"
                    className="bg-green-600 text-white gap-1.5"
                  >
                    <span className="size-1.5 rounded-full bg-white animate-pulse" />
                    Running
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="gap-1.5">
                    <span className="size-1.5 rounded-full bg-muted-foreground" />
                    Stopped
                  </Badge>
                )}
              </div>

              {endpoint && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">URL:</span>
                  <code className="rounded bg-muted px-2 py-0.5 text-xs font-mono">
                    {endpoint}
                  </code>
                </div>
              )}
            </div>

            {/* SDK Connect + API Docs */}
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <SdkConnectDialog
                serverUrl={endpoint || "http://localhost:8080"}
              />
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                render={
                  <a
                    href="https://docs.larkup.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Globe className="size-4" />
                    API Docs
                    <ExternalLink className="size-3" />
                  </a>
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Full Configure Form (reused from tech mode) */}
      <ConfigureForm onHandleReady={onHandleReady} />
    </div>
  );
}
