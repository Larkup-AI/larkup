import type {
  SubmitVideoJobRequest,
  VideoIntelligenceClientContract,
  VideoJob,
  VideoRuntimeMode,
  VideoServiceEntitlement,
  VideoServiceUsage,
} from './contracts.js';

export interface VideoIntelligenceClientOptions {
  mode: VideoRuntimeMode;
  endpoint?: string;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class VideoIntelligenceClient implements VideoIntelligenceClientContract {
  private readonly mode: VideoRuntimeMode;
  private readonly endpoint: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(options: VideoIntelligenceClientOptions) {
    this.mode = options.mode;
    const defaultEndpoint = options.mode === 'local-docker' ? 'http://127.0.0.1:8787' : undefined;
    if (!options.endpoint && !defaultEndpoint) {
      throw new Error(`An endpoint is required for ${options.mode}.`);
    }
    this.endpoint = (options.endpoint ?? defaultEndpoint!).replace(/\/$/, '');
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  health() {
    return this.request<{ status: string; version: string; operators: Record<string, string> }>(
      '/v1/health',
    );
  }

  provisionDeviceAccess(installationId: string): Promise<{
    apiKey: string;
    entitlement: VideoServiceEntitlement;
  }> {
    return this.request('/v1/device-keys', {
      method: 'POST',
      body: JSON.stringify({ installationId }),
      anonymous: true,
    });
  }

  async upload(file: Blob, fileName: string): Promise<{ uploadId: string }> {
    if (this.mode === 'managed-cloud') {
      const initialized = await this.request<{
        uploadId: string;
        uploadUrl: string;
        uploadHeaders: Record<string, string>;
      }>('/v1/uploads', {
        method: 'POST',
        body: JSON.stringify({
          fileName,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      });
      const uploaded = await this.fetcher(initialized.uploadUrl, {
        method: 'PUT',
        headers: initialized.uploadHeaders,
        body: file,
      });
      if (!uploaded.ok) throw new Error(`Video upload returned HTTP ${uploaded.status}.`);
      return { uploadId: initialized.uploadId };
    }
    const form = new FormData();
    form.append('file', file, fileName);
    return this.request('/v1/uploads', { method: 'POST', body: form });
  }

  submitJob(request: SubmitVideoJobRequest): Promise<VideoJob> {
    return this.request('/v1/jobs', { method: 'POST', body: JSON.stringify(request) });
  }

  async getJob(jobId: string): Promise<VideoJob> {
    const job = await this.request<VideoJob>(`/v1/jobs/${encodeURIComponent(jobId)}`);
    if (job.status === 'completed' && !job.result && job.resultUrl) {
      const response = await this.fetcher(job.resultUrl);
      if (!response.ok) throw new Error(`Video result returned HTTP ${response.status}.`);
      job.result = (await response.json()) as VideoJob['result'];
      await this.request(`/v1/jobs/${encodeURIComponent(jobId)}/result/ack`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    }
    return job;
  }

  cancelJob(jobId: string): Promise<VideoJob> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  }

  getUsage(): Promise<VideoServiceUsage> {
    return this.request('/v1/usage');
  }

  redeemAccessCode(
    code: string,
  ): Promise<{ apiKey: string; entitlement: VideoServiceEntitlement }> {
    return this.request('/v1/access-codes/redeem', {
      method: 'POST',
      body: JSON.stringify({ code }),
      anonymous: true,
    });
  }

  private async request<T>(
    path: string,
    init: RequestInit & { anonymous?: boolean } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (this.apiKey && !init.anonymous) headers.set('Authorization', `Bearer ${this.apiKey}`);
    try {
      const response = await this.fetcher(`${this.endpoint}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as T & {
        detail?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          body.detail ?? body.error ?? `Video service returned HTTP ${response.status}.`,
        );
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }
}
