"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/components/workspace/workspace-provider";

interface TechSetupProps {
  onBack: () => void;
}

export function TechSetup({ onBack }: TechSetupProps) {
  const { setUsername, createServer, setMode } = useWorkspace();
  const [username, setName] = useState("");
  const [serverName, setServerName] = useState("my-first-rag");
  const [busy, setBusy] = useState(false);

  async function start() {
    const who = username.trim();
    const srv = serverName.trim();
    if (!who) {
      toast.error("Tell us your name first.");
      return;
    }
    if (!srv) {
      toast.error("Name your first server.");
      return;
    }
    setBusy(true);
    try {
      await setUsername(who);
      await createServer(srv);
      await setMode("tech");
      toast.success(`Welcome, ${who}! "${srv}" is ready.`);
    } catch {
      toast.error("Setup failed. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: '#FCFCFB' }}>
      {/* Background blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 h-[500px] w-[500px] rounded-full bg-stone-200/40 blur-3xl animate-pulse" />
        <div className="absolute -bottom-32 -right-32 h-[600px] w-[600px] rounded-full bg-amber-100/30 blur-3xl animate-pulse [animation-delay:1s]" />
      </div>

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-8 px-6">
        {/* Back button */}
        <button
          type="button"
          onClick={onBack}
          className="absolute left-6 top-8 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors sm:left-0 sm:top-0 sm:relative sm:self-start sm:-mt-4"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>

        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <img src="/logo9.png" className="size-7" alt="Larkup" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Set up your workspace
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
              Build, index, and serve your own RAG pipelines. Let&apos;s create
              your first server.
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="w-full rounded-2xl border bg-transparent p-6 space-y-5">
          <div className="grid gap-2">
            <Label htmlFor="tech-name">What should we call you?</Label>
            <Input
              id="tech-name"
              autoFocus
              value={username}
              placeholder="Your name"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tech-server">Name your first server</Label>
            <Input
              id="tech-server"
              value={serverName}
              placeholder="my-first-rag"
              onChange={(e) => setServerName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void start();
              }}
            />
          </div>

          <Button
            className="w-full"
            size="lg"
            onClick={() => void start()}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4" />
            )}
            Create my first server
          </Button>
        </div>
      </div>
    </div>
  );
}
