import type { RagConfig } from '@larkup/core/types';

export type WidgetSettings = Required<NonNullable<RagConfig['widget']>>;
export type EmbedTab = 'javascript' | 'react' | 'api';

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  title: 'Ask us anything',
  welcomeMessage: 'Hi! How can I help?',
  placeholder: 'Type a message…',
  primaryColor: '#111827',
  position: 'bottom-right',
  darkMode: false,
  customCss: '',
  logoUrl: '',
};
