import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2, Cloud } from "lucide-react";
import type { CustomModelConfig } from "@larkup/core/types";

export function CustomModelModal({
  open,
  onOpenChange,
  onSave,
  type,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: CustomModelConfig) => void;
  type: "embedding" | "chat";
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelName, setModelName] = useState("");
  const [dimensions, setDimensions] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);
  const [verified, setVerified] = useState(false);

  // Reset form every time the modal opens so users always start fresh.
  useEffect(() => {
    if (open) {
      setBaseUrl("");
      setApiKey("");
      setModelName("");
      setDimensions(null);
      setShowApiKey(false);
      setVerified(false);
    }
  }, [open]);

  const handleTest = async () => {
    if (!baseUrl || !modelName) {
      toast.error("Base URL and Model Name are required");
      return;
    }
    setTesting(true);
    try {
      if (type === "embedding") {
        const res = await fetch("/api/config/test-embedding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseUrl, apiKey, modelName }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Connection failed");

        setDimensions(data.dimensions);
        setVerified(true);
        toast.success(`Success! Detected ${data.dimensions} dimensions.`);
      } else {
        const res = await fetch("/api/config/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            chatProvider: "custom", 
            chatApiKey: apiKey,
            customChatModels: [{ baseUrl, apiKey, modelName }]
           }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Connection failed");
        
        setVerified(true);
        toast.success(`Success! Chat model connected.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
      setDimensions(null);
      setVerified(false);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!baseUrl || !modelName || !verified) {
      toast.error("Please test the connection first.");
      return;
    }
    onSave({ baseUrl, apiKey, modelName, dimensions: dimensions ?? undefined });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={"max-w-xl"}>
        <DialogHeader>
          <DialogTitle>Custom {type === "embedding" ? "Embedding" : "Chat"} Model</DialogTitle>
          <DialogDescription>
            Connect an OpenAI-compatible {type === "embedding" ? "embedding" : "chat"} model.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input
              id="baseUrl"
              placeholder="https://api.example.com/v1"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setVerified(false);
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="apiKey">API Key (Optional)</Label>
            <div className="relative">
              <Input
                id="apiKey"
                type={showApiKey ? "text" : "password"}
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setVerified(false);
                }}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="modelName">Model Name</Label>
            <Input
              id="modelName"
              placeholder={type === "embedding" ? "my-embedding-model" : "my-chat-model"}
              value={modelName}
              onChange={(e) => {
                setModelName(e.target.value);
                setVerified(false);
              }}
            />
          </div>
          {verified && (
            <div className="text-sm text-green-600 dark:text-green-400 font-medium">
              ✓ Connection verified {dimensions ? `(${dimensions} dimensions)` : ""}
            </div>
          )}
        </div>
        <DialogFooter className="flex flex-row justify-between sm:justify-between items-center gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : (
              <Cloud className="size-4 mr-2" />
            )}
            Test Connection
          </Button>
          <Button
            className={"px-5"}
            onClick={handleSave}
            disabled={!verified}
          >
            Add Model
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
