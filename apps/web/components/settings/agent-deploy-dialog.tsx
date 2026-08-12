'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileCode2,
  Loader2,
  Rocket,
  Server,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface BundleFile {
  path: string;
  language: string;
  contents: string;
  bytes: number;
}

interface EnvVar {
  key: string;
  required: boolean;
  help: string;
}

interface Bundle {
  releaseId: string;
  version: string;
  projectName: string;
  envVars: EnvVar[];
  files: BundleFile[];
}

/** Files worth showing first; the rest are scaffolding. */
const PREVIEW_ORDER = [
  'README.md',
  'release.json',
  'docker-compose.yml',
  'Dockerfile',
  'service.cloudrun.yaml',
  '.env.example',
  'server.mjs',
  'package.json',
];

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error('Could not copy.');
        }
      }}
    >
      {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

export function AgentDeployDialog({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [selected, setSelected] = useState('README.md');
  const [downloading, setDownloading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/bundle?preview=1`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not build the bundle');
      setBundle(body);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not build the bundle');
      setBundle(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Download the full bundle, widget included.
   *
   * Assembled in the browser rather than server-side: the files are already
   * plain text and a zip endpoint would be one more thing to keep in step with
   * the generator.
   */
  async function download() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/bundle`);
      const full: Bundle = await res.json();
      if (!res.ok) throw new Error('Could not build the bundle');

      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const file of full.files) zip.file(file.path, file.contents);

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${full.projectName}-v${full.version}.zip`;
      link.click();
      URL.revokeObjectURL(url);

      toast.success('Bundle downloaded. Run `docker compose up --build` inside it.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  const files = bundle
    ? [...bundle.files].sort((a, b) => {
        const ai = PREVIEW_ORDER.indexOf(a.path);
        const bi = PREVIEW_ORDER.indexOf(b.path);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
    : [];
  const current = files.find((f) => f.path === selected) ?? files[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground">
            <Rocket className="size-3" />
            Deploy
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Deploy — {agentName}</DialogTitle>
          <DialogDescription>
            A portable container carrying one immutable release. The same image runs on Docker/VPS,
            Cloud Run, Container Apps, and App Runner — only the environment bindings differ.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Building the bundle…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium">{error}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Publish a release under <strong>Releases</strong> first — a deployment always
                carries a specific, immutable release.
              </p>
            </div>
          </div>
        )}

        {bundle && !loading && (
          <div className="grid gap-4 py-1">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-4 py-3">
              <Server className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{bundle.projectName}</span>
              <Badge variant="outline" className="font-mono text-[10px]">
                v{bundle.version}
              </Badge>
              <span className="font-mono text-[11px] text-muted-foreground">
                {bundle.releaseId.slice(0, 12)}…
              </span>
              <div className="ml-auto">
                <Button
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => void download()}
                  disabled={downloading}
                >
                  <Download className="size-3" />
                  {downloading ? 'Preparing…' : 'Download bundle'}
                </Button>
              </div>
            </div>

            <div className="grid gap-1.5">
              <p className="text-xs font-medium">Run it</p>
              <div className="relative rounded-lg border bg-muted/40">
                <div className="absolute right-2 top-2">
                  <CopyButton
                    value={`cp .env.example .env\ndocker compose up --build\ncurl localhost:8080/readiness`}
                  />
                </div>
                <pre className="overflow-x-auto p-3 pr-24 font-mono text-[11px] leading-relaxed">
                  {`cp .env.example .env    # add your model key\ndocker compose up --build\ncurl localhost:8080/readiness`}
                </pre>
              </div>
            </div>

            <div className="grid gap-1.5">
              <p className="text-xs font-medium">Secrets to supply at run time</p>
              <div className="grid gap-1">
                {bundle.envVars.map((env) => (
                  <div key={env.key} className="flex items-start gap-2 rounded-md border px-3 py-2">
                    <code className="shrink-0 font-mono text-[11px] font-medium">{env.key}</code>
                    {env.required && (
                      <Badge variant="secondary" className="h-4 shrink-0 text-[9px]">
                        required
                      </Badge>
                    )}
                    <span className="text-[11px] text-muted-foreground">{env.help}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                No credential is baked into the image — the release snapshot carries behaviour only.
              </p>
            </div>

            <div className="grid gap-1.5">
              <p className="text-xs font-medium">Bundle contents</p>
              <div className="flex flex-wrap gap-1">
                {files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelected(file.path)}
                    className={`rounded-md border px-2 py-1 font-mono text-[10px] transition-colors ${
                      current?.path === file.path
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {file.path}
                  </button>
                ))}
              </div>
              {current && (
                <div className="relative rounded-lg border bg-muted/40">
                  <div className="absolute right-2 top-2 flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">
                      {(current.bytes / 1024).toFixed(1)} kB
                    </span>
                    <CopyButton value={current.contents} />
                  </div>
                  <pre className="max-h-72 overflow-auto p-3 pr-28 font-mono text-[11px] leading-relaxed">
                    {current.contents}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex items-start gap-2 rounded-lg border px-4 py-3 text-xs text-muted-foreground">
              <FileCode2 className="mt-0.5 size-3.5 shrink-0" />
              <span>
                To roll back, publish nothing — download the bundle for an earlier release and
                deploy that image. Releases are immutable, so there is no in-place change to undo.
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
