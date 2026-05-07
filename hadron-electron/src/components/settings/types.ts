import type { ProviderKey } from '../../constants/providers';

export type ApiKeyProvider = 'openai' | 'anthropic' | 'zai';

export interface SettingsData {
  provider: ProviderKey;
  apiKeys: Record<ApiKeyProvider, string>;
  model: string;
  customModel: string;
  auxiliaryModel: string;
  piiRedactionEnabled: boolean;
  activeProviders: Record<string, boolean>;
}

export type SettingsSection =
  | 'dashboard'
  | 'ai-provider'
  | 'jira'
  | 'sentry'
  | 'knowledge-base'
  | 'preferences'
  | 'maintenance';

const INTEGRATION_SECTIONS = new Set<SettingsSection>(['jira', 'sentry', 'knowledge-base']);

export function isIntegrationSection(s: SettingsSection | undefined): s is 'jira' | 'sentry' | 'knowledge-base' {
  return s !== undefined && INTEGRATION_SECTIONS.has(s);
}
