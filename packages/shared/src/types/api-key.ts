export type ApiKeyScope = 'user' | 'namespace' | 'endpoint';

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  scope: ApiKeyScope;
  namespaceId?: string;
  endpointId?: string;
  rateLimit: number;
  expiresAt?: Date;
  lastUsedAt?: Date;
  isActive: boolean;
  createdAt: Date;
}

export interface CreateApiKeyInput {
  name: string;
  scope?: ApiKeyScope;
  namespaceId?: string;
  endpointId?: string;
  rateLimit?: number;
  expiresAt?: Date;
}
