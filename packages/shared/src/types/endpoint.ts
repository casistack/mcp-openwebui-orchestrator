export type EndpointTransport = 'sse' | 'streamable-http' | 'openapi';
export type EndpointAuthType = 'none' | 'api_key' | 'oauth' | 'bearer';

export interface Endpoint {
  id: string;
  namespaceId: string;
  name: string;
  slug: string;
  transport: EndpointTransport;
  isActive: boolean;
  authType: EndpointAuthType;
  oauthConfig?: Record<string, unknown>;
  rateLimit: number;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEndpointInput {
  namespaceId: string;
  name: string;
  slug: string;
  transport: EndpointTransport;
  authType?: EndpointAuthType;
  rateLimit?: number;
}
