"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "@/lib/error-formatter";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PastePanel({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!content.trim()) {
      toast.error("Nothing to add — paste some text first.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Pasted text",
          content,
          source: "paste",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Added to corpus");
      setTitle("");
      setContent("");
      onAdded();
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 w-full">
      <div className="space-y-2">
        <Label htmlFor="paste-title">Title</Label>
        <Input
          id="paste-title"
          placeholder="Demo Title"
          className="w-full"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="paste-content">Content</Label>
        <Textarea
          id="paste-content"
          placeholder="Paste any text, markdown, or notes here…"
          className="min-h-48 placeholder:text-muted-foreground/50 placeholder:text-xs font-mono text-xs leading-relaxed bg-white"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <p className="text-xs text-muted-foreground tabular-nums">
          {content.length.toLocaleString()} characters
        </p>
      </div>
      <Button onClick={submit} disabled={saving}>
        {saving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
        Add to corpus
      </Button>
    </div>
  );
}
