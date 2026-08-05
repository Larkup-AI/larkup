export interface IntegrationResource {
  id: string;
  title: string;
  url?: string;
  updatedAt?: string;
  kind?: string;
  metadata?: Record<string, string>;
}

export interface IntegrationDocument extends IntegrationResource {
  content: string;
}

export type IntegrationId =
  | 'notion'
  | 'google-analytics'
  | 'google-calendar'
  | 'google-docs'
  | 'google-drive'
  | 'google-maps'
  | 'google-meet'
  | 'google-sheets'
  | 'google-slides'
  | 'jira'
  | 'linear'
  | 'slack'
  | 'github'
  | 'confluence';

export interface OAuthIntegrationDefinition {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  accessTokenEnv: string;
  clientAuthentication: 'basic' | 'body';
  authorizationParams?: Record<string, string>;
}

export interface IntegrationDefinition {
  id: IntegrationId;
  name: string;
  category: string;
  description: string;
  icon: string;
  status: 'ready';
  oauth: OAuthIntegrationDefinition;
}

/** A visible catalog entry whose data reader has not been implemented yet. */
export interface ComingSoonIntegrationDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  status: 'coming-soon';
}

export type IntegrationCatalogEntry = IntegrationDefinition | ComingSoonIntegrationDefinition;

export interface IntegrationReader {
  listResources(accessToken: string): Promise<IntegrationResource[]>;
  getResource(accessToken: string, resource: IntegrationResource): Promise<IntegrationDocument>;
}
