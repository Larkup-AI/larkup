"use client";

import { useState } from "react";
import { Code2, Sparkles, ArrowRight, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";

interface WelcomeScreenProps {
  onSelectTech: () => void;
  onSelectSimple: () => void;
}

export function WelcomeScreen({
  onSelectTech,
  onSelectSimple,
}: WelcomeScreenProps) {
  const [hovered, setHovered] = useState<"tech" | "simple" | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: '#FCFCFB' }}>
      {/* Subtle animated background pattern */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 h-[500px] w-[500px] rounded-full bg-stone-200/40 blur-3xl animate-pulse" />
        <div className="absolute -bottom-32 -right-32 h-[600px] w-[600px] rounded-full bg-amber-100/30 blur-3xl animate-pulse [animation-delay:1s]" />
        <div className="absolute left-1/2 top-1/3 h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-stone-100/50 blur-3xl animate-pulse [animation-delay:2s]" />
      </div>

      <div className="relative z-10 flex w-full max-w-4xl flex-col items-center gap-10 px-6">
        {/* Header */}
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <img src="/logo9.png" className="size-8" alt="Larkup" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Welcome to Larkup
            </h1>
            <p className="mt-2 text-base text-muted-foreground max-w-md mx-auto text-pretty">
              Build, index, and query your knowledge base with AI. How would you
              like to get started?
            </p>
          </div>
        </div>

        {/* Cards */}
        <div className="grid w-full gap-5 sm:grid-cols-2">
          {/* Tech Card */}
          <button
            type="button"
            onClick={onSelectTech}
            onMouseEnter={() => setHovered("tech")}
            onMouseLeave={() => setHovered(null)}
            className={cn(
              "group relative flex flex-col items-start gap-5 rounded-2xl border-2 bg-transparent p-7 text-left transition-all duration-300 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary",
              hovered === "tech"
                ? "border-primary scale-[1.02]"
                : hovered === "simple"
                  ? "border-border/60 opacity-70"
                  : "border-border hover:border-primary/40",
            )}
          >
            <div className="flex w-full items-start justify-between">
              <div
                className={cn(
                  "flex size-12 items-center justify-center rounded-xl transition-colors duration-300",
                  hovered === "tech"
                    ? "bg-primary text-primary-foreground"
                    : "bg-slate-100 text-slate-600",
                )}
              >
                <Code2 className="size-6" />
              </div>
              <ArrowRight
                className={cn(
                  "size-5 text-muted-foreground transition-all duration-300",
                  hovered === "tech" ? "translate-x-1 text-primary" : "",
                )}
              />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-foreground">
                Developer Mode
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Full control over your RAG pipeline, configure embeddings,
                vector stores, indexing strategies, and deploy a custom server.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                "Pipeline Control",
                "Custom Vector Stores",
                "Server Deploy",
              ].map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>

            <span
              className={cn(
                "text-xs font-medium transition-colors",
                hovered === "tech"
                  ? "text-primary"
                  : "text-muted-foreground/60",
              )}
            >
              I know what I&apos;m doing →
            </span>
          </button>

          {/* Simple Card */}
          <button
            type="button"
            onClick={onSelectSimple}
            onMouseEnter={() => setHovered("simple")}
            onMouseLeave={() => setHovered(null)}
            className={cn(
              "group relative flex flex-col items-start gap-5 rounded-2xl border-2 bg-transparent p-7 text-left transition-all duration-300 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary",
              hovered === "simple"
                ? "border-primary scale-[1.02]"
                : hovered === "tech"
                  ? "border-border/60 opacity-70"
                  : "border-border hover:border-primary/30",
            )}
          >
            <div className="flex w-full items-start justify-between">
              <div
                className={cn(
                  "flex size-12 items-center justify-center rounded-xl transition-colors duration-300",
                  hovered === "simple"
                    ? "bg-primary text-primary-foreground"
                    : "bg-primary/10 text-primary",
                )}
              >
                <Sparkles className="size-6" />
              </div>
              <ArrowRight
                className={cn(
                  "size-5 text-muted-foreground transition-all duration-300",
                  hovered === "simple" ? "translate-x-1 text-primary" : "",
                )}
              />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-foreground">
                Simple Mode
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Just upload your documents and start chatting. we&apos;ll handle
                the rest. Perfect for getting quick answers from your knowledge
                base.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {["Upload & Chat", "Auto Setup", "Instant RAG"].map((tag) => (
                <span key={tag} className="rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                  {tag}
                </span>
              ))}
            </div>

            <span
              className={cn(
                "text-xs font-medium transition-colors",
                hovered === "simple" ? "text-primary" : "text-muted-foreground/60",
              )}
            >
              Just let my LLM know my docs →
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
