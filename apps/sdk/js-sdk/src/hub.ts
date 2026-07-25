import type {
  LarkupHubClientOptions,
  ListToolsRequest,
  ToolDetailResponse,
  ToolListResponse,
} from './types';
import { LarkupApiError } from './client';

export class LarkupHubClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: LarkupHubClientOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.LARKUP_HUB_URL ??
      'https://hub.larkup.de'
    ).replace(/\/+$/, '');
    this.apiKey = options.apiKey;
  }

  private async get<T>(path: string): Promise<T> {
    const headers = new Headers();
    if (this.apiKey) headers.set('Authorization', `Bearer ${this.apiKey}`);
    const response = await fetch(`${this.baseUrl}${path}`, { headers });
    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = (await response.json()) as { error?: string };
        message = body.error || message;
      } catch {}
      throw new LarkupApiError(response.status, message);
    }
    return response.json() as Promise<T>;
  }

  /** Lists Marketplace tools from the Larkup Hub catalog. */
  listTools(request: ListToolsRequest = {}): Promise<ToolListResponse> {
    const params = new URLSearchParams();
    if (request.category) params.set('category', request.category);
    if (request.search) params.set('search', request.search);
    if (request.page !== undefined) params.set('page', String(request.page));
    if (request.limit !== undefined) params.set('limit', String(request.limit));
    const query = params.size > 0 ? `?${params}` : '';
    return this.get(`/v1/tools${query}`);
  }

  /** Returns one Marketplace tool and its version history. */
  getTool(id: string): Promise<ToolDetailResponse> {
    return this.get(`/v1/tools/${encodeURIComponent(id)}`);
  }
}
