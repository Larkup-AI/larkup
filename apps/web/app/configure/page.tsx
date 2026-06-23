"use client";

import { useState, useCallback } from "react";
import { PageHeader } from "@/components/page-header";
import {
  ConfigureForm,
  type ConfigureFormHandle,
} from "@/components/configure/configure-form";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Check } from "lucide-react";

export default function ConfigurePage() {
  const [handle, setHandle] = useState<ConfigureFormHandle | null>(null);

  const onHandleReady = useCallback((h: ConfigureFormHandle) => {
    setHandle({ ...h });
  }, []);

  const dirty = handle?.dirty ?? false;
  const saving = handle?.saving ?? false;

  return (
    <div className="flex  min-h-full flex-col">
      <PageHeader
        eyebrow="Step 1 · Configure"
        title="Pipeline configuration"
        description="Choose your embedding model, indexing strategy, and vector store. "
        actions={
          <Button
            size="lg"
            variant={dirty ? "default" : "default"}
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
        }
      />
      <ConfigureForm onHandleReady={onHandleReady} />
    </div>
  );
}
