export type AuditAction =
  | 'server.create' | 'server.update' | 'server.delete' | 'server.start' | 'server.stop' | 'server.restart'
  | 'namespace.create' | 'namespace.update' | 'namespace.delete'
  | 'endpoint.create' | 'endpoint.update' | 'endpoint.delete'
  | 'user.login' | 'user.logout' | 'user.create' | 'user.update' | 'user.delete'
  | 'apikey.create' | 'apikey.revoke'
  | 'tool.execute' | 'tool.filter.update'
  | 'config.reload' | 'config.import' | 'config.export'
  | 'secret.create' | 'secret.update' | 'secret.delete' | 'secret.rotate';

export type AuditResource = 'server' | 'namespace' | 'endpoint' | 'user' | 'apikey' | 'tool' | 'config' | 'secret';
export type AuditStatus = 'success' | 'failure' | 'denied';

export interface AuditLog {
  id: string;
  userId?: string;
  action: AuditAction;
  resource: AuditResource;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  status: AuditStatus;
  durationMs?: number;
  createdAt: Date;
}
