export interface WidgetSettings {
  title?: string;
  welcomeMessage?: string;
  placeholder?: string;
  primaryColor?: string;
  position?: string;
  darkMode?: boolean;
  logoUrl?: string;
  customCss?: string;
}
export function widgetScript(config?: { widget?: WidgetSettings }): string;
export function reactWidgetSnippet(input: {
  baseUrl: string;
  apiKey?: string;
  widget?: WidgetSettings;
}): string;
export function agentSdkSnippet(baseUrl: string): string;
export function scalarReferenceHtml(): string;
export function serverOpenApiDocument(profile?: 'agent' | 'knowledge'): Record<string, unknown>;
