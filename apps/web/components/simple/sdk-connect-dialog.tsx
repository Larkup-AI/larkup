"use client";

import { useState } from "react";
import { Code2, Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CodeViewer } from "@/components/server/code-viewer";

const TABS = [
  { id: "python", label: "Python" },
  { id: "typescript", label: "TypeScript" },
  { id: "openai", label: "OpenAI Compatible" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function getSnippets(serverUrl: string): Record<TabId, string> {
  return {
    python: `# Install: pip install larkup-rag
from larkup_rag import LarkupRAGClient, LarkupRAGClientOptions

options = LarkupRAGClientOptions(
    base_url="${serverUrl}",
    api_key="your-api-key"
)

client = LarkupRAGClient(options)

# Add a document
from larkup_rag import Document

doc = Document(
    id="doc-1",
    text="Your document text here.",
    title="Example Document"
)
client.add_document(doc)

# Query
results = client.query("What is this about?", top_k=5)
for hit in results.hits:
    print(f"Score: {hit.score} | Text: {hit.text}")`,

    typescript: `// Install: npm install @larkup/rag-sdk
import { LarkupRAGClient } from "@larkup/rag-sdk";

const client = new LarkupRAGClient({
  baseUrl: "${serverUrl}",
  apiKey: "your-api-key",
});

// Add a document
await client.addDocument({
  id: "doc-1",
  text: "Your document text here.",
  title: "Example Document",
});

// Query
const results = await client.query("What is this about?", 5);
for (const hit of results.hits) {
  console.log(\`Score: \${hit.score} | Text: \${hit.text}\`);
}`,

    openai: `// Connect via OpenAI-compatible endpoint
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

const larkup = createOpenAI({
  baseURL: '${serverUrl}/v1',
  apiKey: 'your-api-key',
});

const { text } = await generateText({
  model: larkup('rag-model'),
  prompt: 'What is this about?',
});

console.log(text);`,
  };
}

export function SdkConnectDialog({ serverUrl }: { serverUrl: string }) {
  const [activeTab, setActiveTab] = useState<TabId>("python");
  const [copied, setCopied] = useState(false);

  const snippets = getSnippets(serverUrl || "http://localhost:8080");
  const currentSnippet = snippets[activeTab];

  async function handleCopy() {
    await navigator.clipboard.writeText(currentSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" className="gap-2">
            <Code2 className="size-4" />
            Connect to Server SDK
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code2 className="size-5 text-primary" />
            Connect to your RAG Server
          </DialogTitle>
          <DialogDescription>
            Use one of these SDKs to programmatically interact with your RAG
            server.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Code block */}
        <div className="relative rounded-lg border bg-slate-50 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 bg-slate-100/50">
            <span className="text-xs text-slate-500 font-mono">
              {activeTab === "python"
                ? "main.py"
                : activeTab === "typescript"
                  ? "index.ts"
                  : "connect.ts"}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
            >
              {copied ? (
                <>
                  <Check className="size-3.5" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>
          <CodeViewer 
            value={currentSnippet} 
            language={activeTab === "python" ? "python" : "javascript"} 
            height="auto"
          />
        </div>

        {/* Docs link */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Server URL:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
              {serverUrl || "Not running"}
            </code>
          </span>
          <a
            href="https://docs.larkup.dev/sdk/overview"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-primary hover:underline"
          >
            Full docs
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
