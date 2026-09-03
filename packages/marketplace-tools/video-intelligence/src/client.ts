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
    const defaultEndpoint =
      options.mode === 'local-docker' || options.mode === 'local-process'
        ? 'http://127.0.0.1:8787'
        : undefined;
    if (!options.endpoint && !defaultEndpoint) {
      throw new Error(`An endpoint is required for ${options.mode}.`);
    }
    this.endpoint = (options.endpoint ?? defaultEndpoint!).replace(/\/$/, '');
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async health() {
    const health = await this.request<{
      status: string;
      version: string;
      operators?: Record<string, string>;
      runtime?: string;
      processingEnabled?: boolean;
    }>('/v1/health');
    const isManagedCloudHealth =
      health.runtime === 'managed-cloud' && typeof health.processingEnabled === 'boolean';
    if (
      health.status !== 'ok' ||
      typeof health.version !== 'string' ||
      !health.version ||
      ((!health.operators || typeof health.operators !== 'object') && !isManagedCloudHealth)
    ) {
      throw new Error('The endpoint did not identify itself as a Video Intelligence runtime.');
    }
    return {
      status: health.status,
      version: health.version,
      operators: health.operators ?? {},
    };
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
    }
    return job;
  }

  acknowledgeJobResult(jobId: string): Promise<{ status: string }> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}/result/ack`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  cancelJob(jobId: string): Promise<VideoJob> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  }

  async purgeJobData(jobId: string): Promise<void> {
    await this.request(`/v1/jobs/${encodeURIComponent(jobId)}/data`, { method: 'DELETE' });
  }

  /** Recovery path for an orphaned local asset. The service refuses ambiguity. */
  cancelOnlyActiveJob(): Promise<{ status: string; alreadyStopped?: boolean }> {
    return this.request('/v1/jobs/active', { method: 'DELETE' });
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
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (this.apiKey && !init.anonymous) headers.set('Authorization', `Bearer ${this.apiKey}`);
    const canRetry = !init.method || init.method === 'GET';
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
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
        const retryAfter = response.headers.get('Retry-After');
        if (response.status === 429 && canRetry && attempt < 2 && retryAfter !== null) {
          const retryAfterSeconds = Number(retryAfter);
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Number.isFinite(retryAfterSeconds)
                ? Math.max(0, Math.min(60, retryAfterSeconds)) * 1_000
                : 60_000,
            ),
          );
          continue;
        }
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
}
