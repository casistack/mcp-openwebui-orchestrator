export interface ToolConfig {
  id: string;
  namespaceId: string;
  serverId: string;
  toolName: string;
  enabled: boolean;
  displayName?: string;
  description?: string;
  annotations?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateToolConfigInput {
  enabled?: boolean;
  displayName?: string;
  description?: string;
  annotations?: Record<string, unknown>;
}
