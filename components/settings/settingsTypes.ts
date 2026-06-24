export interface OAuthProviderStatus {
  connected: boolean;
  email?: string;
  accounts?: { email: string; scopes?: string }[];
}

export interface BuildLogEntry {
  id: string;
  featureName: string;
  description: string;
  outputCode: string;
  success: boolean;
  smokeTestPassed: boolean | null;
  smokeTestArgs: Record<string, unknown> | null;
  createdAt: string;
}

export interface TelegramStatus {
  connected: boolean;
  username: string | null;
  configured: boolean;
  botUsername?: string | null;
}

export interface McpServerInfo {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command: string | null;
  url: string | null;
  enabled: boolean;
  isBuiltIn: boolean;
  connected: boolean;
  toolCount: number;
  error?: string;
  isSystem: boolean;
  credentialMode?: 'direct' | 'env-ref';
  envKey?: string | null;
}

export type OpenAIProviderAuthType = 'api_key' | 'oauth' | 'local';

export interface OpenAIProviderAuthTypeStatus {
  connected: boolean;
  isDefault: boolean;
  email?: string;
  accountId?: string;
  expiresAt?: string;
}

export interface OpenAIProviderAuthStatus {
  providerCatalog?: CatalogProvider[];
  providers?: Record<string, ProviderAuthProviderStatus>;
  openai: {
    connected: boolean;
    defaultAuthType: OpenAIProviderAuthType | null;
    fallbackEnabled: boolean;
    authTypes: Partial<Record<OpenAIProviderAuthType, OpenAIProviderAuthTypeStatus>>;
  };
}

export interface ProviderAuthProviderStatus {
  connected: boolean;
  defaultAuthType: OpenAIProviderAuthType | null;
  fallbackEnabled?: boolean;
  authTypes: Partial<Record<OpenAIProviderAuthType, OpenAIProviderAuthTypeStatus>>;
}

export interface CatalogProvider {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  credentialKinds: ('api_key' | 'oauth' | 'local')[];
  apiKeyPlaceholder?: string;
  setupHint: string;
}
