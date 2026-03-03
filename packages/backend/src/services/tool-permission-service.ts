import crypto from 'crypto';
import { userToolPermissions, sql } from '@mcp-platform/db';
import type { AppDatabase } from '@mcp-platform/db';

export interface ToolPermission {
  id: string;
  userId: string;
  namespaceId: string;
  toolName: string;
  allowed: boolean;
}

export class ToolPermissionService {
  constructor(private readonly db: AppDatabase) {}

  async getPermissions(namespaceId: string, userId?: string): Promise<ToolPermission[]> {
    const rows = await this.db.select().from(userToolPermissions);
    let filtered = rows.filter(r => r.namespaceId === namespaceId);
    if (userId) filtered = filtered.filter(r => r.userId === userId);
    return filtered.map(r => ({
      id: r.id,
      userId: r.userId,
      namespaceId: r.namespaceId,
      toolName: r.toolName,
      allowed: r.allowed,
    }));
  }

  async setPermission(data: {
    userId: string;
    namespaceId: string;
    toolName: string;
    allowed: boolean;
  }): Promise<ToolPermission> {
    const existing = await this.db.select().from(userToolPermissions);
    const match = existing.find(
      r => r.userId === data.userId && r.namespaceId === data.namespaceId && r.toolName === data.toolName
    );

    if (match) {
      this.db.run(
        sql`UPDATE user_tool_permissions SET allowed = ${data.allowed ? 1 : 0}, updated_at = ${Math.floor(Date.now() / 1000)} WHERE id = ${match.id}`
      );
      return { ...match, allowed: data.allowed };
    }

    const perm: ToolPermission = {
      id: crypto.randomUUID(),
      userId: data.userId,
      namespaceId: data.namespaceId,
      toolName: data.toolName,
      allowed: data.allowed,
    };

    this.db.insert(userToolPermissions).values({
      id: perm.id,
      userId: perm.userId,
      namespaceId: perm.namespaceId,
      toolName: perm.toolName,
      allowed: perm.allowed,
    }).run();

    return perm;
  }

  async deletePermission(permissionId: string): Promise<boolean> {
    const rows = await this.db.select().from(userToolPermissions);
    const match = rows.find(r => r.id === permissionId);
    if (!match) return false;
    this.db.run(sql`DELETE FROM user_tool_permissions WHERE id = ${permissionId}`);
    return true;
  }

  async checkAccess(userId: string, namespaceId: string, toolName: string): Promise<boolean> {
    const rows = await this.db.select().from(userToolPermissions);
    const match = rows.find(
      r => r.userId === userId && r.namespaceId === namespaceId && r.toolName === toolName
    );
    // No explicit rule means allowed (default-allow policy)
    if (!match) return true;
    return match.allowed;
  }

  async bulkSetPermissions(userId: string, namespaceId: string, rules: Array<{ toolName: string; allowed: boolean }>): Promise<void> {
    for (const rule of rules) {
      await this.setPermission({ userId, namespaceId, toolName: rule.toolName, allowed: rule.allowed });
    }
  }

  async getUserBlockedTools(userId: string, namespaceId: string): Promise<string[]> {
    const perms = await this.getPermissions(namespaceId, userId);
    return perms.filter(p => !p.allowed).map(p => p.toolName);
  }
}
