export type McpTransport = 'stdio' | 'sse' | 'streamable-http';
export type ServerStatus = 'active' | 'inactive' | 'error' | 'starting' | 'stopping';
export type ProxyType = 'mcpo' | 'mcp-bridge' | 'supergateway';
export type NetworkPolicy = 'default' | 'isolated' | 'restricted';

export interface McpServerConfig {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  transport: McpTransport;
  // STDIO config
  command?: string;
  args?: string[];
  cwd?: string;
  // URL-based config (SSE, Streamable HTTP)
  url?: string;
  headers?: Record<string, string>;
  // Proxy settings
  proxyType: ProxyType;
  needsProxy: boolean;
  // Resource limits
  cpuLimit?: string;
  memoryLimit?: string;
  networkPolicy: NetworkPolicy;
  // Status
  status: ServerStatus;
  isPublic: boolean;
  // Ownership
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateServerInput {
  name: string;
  displayName?: string;
  description?: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  proxyType?: ProxyType;
  needsProxy?: boolean;
  cpuLimit?: string;
  memoryLimit?: string;
  networkPolicy?: NetworkPolicy;
  isPublic?: boolean;
  env?: Record<string, string>;
}

export interface UpdateServerInput {
  displayName?: string;
  description?: string;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  cpuLimit?: string;
  memoryLimit?: string;
  networkPolicy?: NetworkPolicy;
  isPublic?: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  responseTime?: number;
  error?: string;
  tools?: string[];
}
