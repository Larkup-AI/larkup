/*
import { useState } from "react";
import {
  Download,
  FileCode,
  KeyRound,
  Package,
  Rocket,
} from "lucide-react";
import type { RagConfig } from "@larkup-rag/core/types";
import type {
  GeneratedFile,
  GeneratedServer,
} from "@larkup-rag/core/generator/generate-server";
import { getVectorStore } from "@larkup-rag/vector-stores/registry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { CodeViewer } from "@/components/server/code-viewer";

export function ServerSummary({
  config,
  server,
}: {
  config: RagConfig;
  server: GeneratedServer;
}) {
  const store = getVectorStore(config.vectorStore);
  const deps = Object.entries(server.dependencies);
  const requiredEnv = server.envVars.filter((e) => e.required);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="size-4 text-primary" />
          Generated server
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm leading-relaxed text-muted-foreground">
          A standalone, dependency-minimal RAG server tailored to your{" "}
          <span className="font-medium text-foreground">{store.label}</span>{" "}
          configuration. It ships only the packages this store needs — no build
          step, runs with{" "}
          <code className="font-mono text-xs">node server.mjs</code>.
        </p>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Package className="size-3.5" />
              Dependencies ({deps.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {deps.map(([name, version]) => (
                <Badge
                  key={name}
                  variant="secondary"
                  className="font-mono text-[11px] font-normal"
                >
                  {name}@{version}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {store.label} only — other stores are excluded from the bundle.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <KeyRound className="size-3.5" />
              Required env vars ({requiredEnv.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {requiredEnv.map((e) => (
                <Badge
                  key={e.key}
                  variant="outline"
                  className="font-mono text-[11px] font-normal"
                >
                  {e.key}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Set these in <code className="font-mono">.env</code> before
              running.
            </p>
          </div>
        </div>

        <Separator />

        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/api/server/generate?download=1"
            download
            className={buttonVariants()}
          >
            <Download className="size-4" />
            Download server (.zip)
          </a>
          <p className="text-sm text-muted-foreground">
            {server.files.length} files · ready to deploy to Docker or Vercel
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function FileExplorer({
  files,
  project,
}: {
  files: GeneratedFile[];
  project: string;
}) {
  const [active, setActive] = useState(
    files.find((f) => f.path === "server.mjs")?.path ?? files[0]?.path,
  );
  const current = files.find((f) => f.path === active);

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileCode className="size-4 text-primary" />
          <span className="font-mono text-sm">{project}/</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr]">
          <nav className="border-b border-border md:border-b-0 md:border-r">
            <ScrollArea className="h-auto md:h-112">
              <ul className="p-2">
                {files.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => setActive(f.path)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-xs transition-colors",
                        f.path === active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <FileCode className="size-3.5 shrink-0" />
                      <span className="truncate">{f.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </nav>

          <div className="min-w-0">
            {current && (
              <>
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {current.path}
                  </span>
                  // <CopyButton text={current.contents} /> 
                  // Missing CopyButton, removed for archive
                </div>
                <div className="h-96 md:h-104">
                  <CodeViewer
                    value={current.contents}
                    language={current.language}
                    height="100%"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
*/
