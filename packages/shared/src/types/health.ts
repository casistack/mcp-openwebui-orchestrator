export interface HealthRecord {
  id: string;
  serverId: string;
  healthy: boolean;
  responseTime?: number;
  statusCode?: number;
  error?: string;
  endpoint?: string;
  checkedAt: Date;
}

export interface ServerHealthStats {
  serverId: string;
  healthy: boolean;
  lastCheck?: Date;
  responseTime?: number;
  uptime: number;
  failureRate: number;
  consecutiveFailures: number;
  totalChecks: number;
  averageResponseTime: number;
  authError: boolean;
}

export interface HealthReport {
  timestamp: Date;
  totalServers: number;
  healthyServers: number;
  unhealthyServers: number;
  averageResponseTime: number;
  servers: Record<string, ServerHealthStats>;
}
