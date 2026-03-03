import { randomUUID } from 'node:crypto';
import { userEndpointTokens } from '@mcp-platform/db';

export interface TokenRow {
  id: string;
  userId: string;
  endpointId: string;
  provider: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string | null;
  tokenType: string | null;
  status: string | null;
  lastUsedAt: Date | null;
  lastRefreshedAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface SetTokenInput {
  userId: string;
  endpointId: string;
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string;
  tokenType?: string;
  metadata?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseLike = any;

export class OAuthTokenService {
  constructor(private db: DatabaseLike) {}

  private async allRows(): Promise<TokenRow[]> {
    return this.db.select().from(userEndpointTokens) as Promise<TokenRow[]>;
  }

  async getTokensForUser(userId: string, endpointId?: string): Promise<TokenRow[]> {
    const rows = await this.allRows();
    return rows.filter((r: TokenRow) => {
      if (r.userId !== userId) return false;
      if (endpointId && r.endpointId !== endpointId) return false;
      return true;
    });
  }

  async getToken(userId: string, endpointId: string, provider: string): Promise<TokenRow | null> {
    const rows = await this.allRows();
    return rows.find(
      (r: TokenRow) => r.userId === userId && r.endpointId === endpointId && r.provider === provider
    ) ?? null;
  }

  async getActiveToken(userId: string, endpointId: string, provider: string): Promise<TokenRow | null> {
    const token = await this.getToken(userId, endpointId, provider);
    if (!token) return null;
    if (token.status === 'revoked') return null;

    if (token.expiresAt && token.expiresAt < new Date()) {
      await this.updateTokenStatus(token.id, 'expired');
      return { ...token, status: 'expired' };
    }

    return token;
  }

  async setToken(input: SetTokenInput): Promise<TokenRow> {
    const existing = await this.getToken(input.userId, input.endpointId, input.provider);

    if (existing) {
      this.db.run(
        { strings: ['DELETE FROM user_endpoint_tokens WHERE id = ?'], values: [existing.id] } as unknown,
      );
    }

    const now = new Date();
    const row: TokenRow = {
      id: randomUUID(),
      userId: input.userId,
      endpointId: input.endpointId,
      provider: input.provider,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken ?? null,
      expiresAt: input.expiresAt ?? null,
      scopes: input.scopes ?? null,
      tokenType: input.tokenType ?? 'bearer',
      status: 'active',
      lastUsedAt: null,
      lastRefreshedAt: null,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(userEndpointTokens).values(row);
    return row;
  }

  async refreshToken(tokenId: string, newAccessToken: string, newRefreshToken?: string, newExpiresAt?: Date): Promise<boolean> {
    const rows = await this.allRows();
    const token = rows.find((r: TokenRow) => r.id === tokenId);
    if (!token) return false;

    this.db.run(
      { strings: ['DELETE FROM user_endpoint_tokens WHERE id = ?'], values: [tokenId] } as unknown,
    );

    const updated: TokenRow = {
      ...token,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken ?? token.refreshToken,
      expiresAt: newExpiresAt ?? token.expiresAt,
      status: 'active',
      lastRefreshedAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.insert(userEndpointTokens).values(updated);
    return true;
  }

  async revokeToken(tokenId: string): Promise<boolean> {
    const rows = await this.allRows();
    const token = rows.find((r: TokenRow) => r.id === tokenId);
    if (!token) return false;

    await this.updateTokenStatus(tokenId, 'revoked');
    return true;
  }

  async revokeAllForEndpoint(userId: string, endpointId: string): Promise<number> {
    const rows = await this.allRows();
    const matching = rows.filter(
      (r: TokenRow) => r.userId === userId && r.endpointId === endpointId && r.status !== 'revoked'
    );

    for (const token of matching) {
      await this.updateTokenStatus(token.id, 'revoked');
    }

    return matching.length;
  }

  async deleteToken(tokenId: string): Promise<boolean> {
    const rows = await this.allRows();
    const token = rows.find((r: TokenRow) => r.id === tokenId);
    if (!token) return false;

    this.db.run(
      { strings: ['DELETE FROM user_endpoint_tokens WHERE id = ?'], values: [tokenId] } as unknown,
    );
    return true;
  }

  async markUsed(tokenId: string): Promise<void> {
    const rows = await this.allRows();
    const token = rows.find((r: TokenRow) => r.id === tokenId);
    if (!token) return;

    this.db.run(
      { strings: ['DELETE FROM user_endpoint_tokens WHERE id = ?'], values: [tokenId] } as unknown,
    );
    await this.db.insert(userEndpointTokens).values({
      ...token,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async getTokenCount(userId?: string): Promise<number> {
    const rows = await this.allRows();
    if (userId) return rows.filter((r: TokenRow) => r.userId === userId).length;
    return rows.length;
  }

  async getExpiredTokens(): Promise<TokenRow[]> {
    const rows = await this.allRows();
    const now = new Date();
    return rows.filter(
      (r: TokenRow) => r.status === 'active' && r.expiresAt && r.expiresAt < now
    );
  }

  private async updateTokenStatus(tokenId: string, status: string): Promise<void> {
    const rows = await this.allRows();
    const token = rows.find((r: TokenRow) => r.id === tokenId);
    if (!token) return;

    this.db.run(
      { strings: ['DELETE FROM user_endpoint_tokens WHERE id = ?'], values: [tokenId] } as unknown,
    );
    await this.db.insert(userEndpointTokens).values({
      ...token,
      status,
      updatedAt: new Date(),
    });
  }
}
