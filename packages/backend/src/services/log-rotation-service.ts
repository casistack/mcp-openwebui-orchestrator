import type { AppDatabase } from '@mcp-platform/db';
import { healthRecords, serverRuntimeLogs, auditLogs, lt } from '@mcp-platform/db';

export interface RetentionConfig {
  healthRecordsDays: number;
  runtimeLogsDays: number;
  auditLogsDays: number;
}

const DEFAULT_RETENTION: RetentionConfig = {
  healthRecordsDays: 30,
  runtimeLogsDays: 14,
  auditLogsDays: 90,
};

export class LogRotationService {
  private interval: ReturnType<typeof setInterval> | null = null;
  private config: RetentionConfig;

  constructor(
    private db: AppDatabase,
    config?: Partial<RetentionConfig>,
  ) {
    this.config = { ...DEFAULT_RETENTION, ...config };
  }

  /**
   * Start periodic log rotation. Runs daily by default.
   */
  start(intervalMs = 24 * 60 * 60 * 1000): void {
    // Run once immediately
    this.rotate().catch(() => {});

    this.interval = setInterval(() => {
      this.rotate().catch(() => {});
    }, intervalMs);
    this.interval.unref();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Perform log rotation — deletes records older than configured retention.
   */
  async rotate(): Promise<{ healthRecords: number; runtimeLogs: number; auditLogs: number }> {
    const results = { healthRecords: 0, runtimeLogs: 0, auditLogs: 0 };

    // Health records
    try {
      const cutoff = this.cutoffDate(this.config.healthRecordsDays);
      const before = await this.db.select().from(healthRecords);
      await this.db.delete(healthRecords).where(lt(healthRecords.checkedAt, cutoff));
      const after = await this.db.select().from(healthRecords);
      results.healthRecords = before.length - after.length;
    } catch { /* table may not exist */ }

    // Runtime logs
    try {
      const cutoff = this.cutoffDate(this.config.runtimeLogsDays);
      const before = await this.db.select().from(serverRuntimeLogs);
      await this.db.delete(serverRuntimeLogs).where(lt(serverRuntimeLogs.createdAt, cutoff));
      const after = await this.db.select().from(serverRuntimeLogs);
      results.runtimeLogs = before.length - after.length;
    } catch { /* table may not exist */ }

    // Audit logs
    try {
      const cutoff = this.cutoffDate(this.config.auditLogsDays);
      const before = await this.db.select().from(auditLogs);
      await this.db.delete(auditLogs).where(lt(auditLogs.createdAt, cutoff));
      const after = await this.db.select().from(auditLogs);
      results.auditLogs = before.length - after.length;
    } catch { /* table may not exist */ }

    if (results.healthRecords > 0 || results.runtimeLogs > 0 || results.auditLogs > 0) {
      console.log(`[log-rotation] Cleaned up: ${results.healthRecords} health records, ${results.runtimeLogs} runtime logs, ${results.auditLogs} audit logs`);
    }

    return results;
  }

  getConfig(): RetentionConfig {
    return { ...this.config };
  }

  private cutoffDate(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }
}
