import crypto from 'crypto';
import { serverEnvVars, eq } from '@mcp-platform/db';
import type { AppDatabase } from '@mcp-platform/db';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 32;

interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  tag: string;
  salt: string;
  version: number;
}

export class SecretsService {
  private readonly db: AppDatabase;
  private derivedKey: Buffer | null = null;
  private masterSecret: string;

  constructor(db: AppDatabase, masterSecret?: string) {
    this.db = db;
    this.masterSecret = masterSecret ?? process.env.SECRETS_MASTER_KEY ?? this.generateDefaultKey();
  }

  private generateDefaultKey(): string {
    // In production, SECRETS_MASTER_KEY env var should be set.
    // This fallback generates a deterministic key from hostname for development only.
    const hostname = process.env.HOSTNAME ?? 'mcp-platform-dev';
    return crypto.createHash('sha256').update(`dev-only-${hostname}`).digest('hex');
  }

  private deriveKey(salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(
      this.masterSecret,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      'sha512',
    );
  }

  encrypt(plaintext: string): EncryptedPayload {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = this.deriveKey(salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(
      ALGORITHM, key, iv,
      { authTagLength: TAG_LENGTH } as crypto.CipherGCMOptions,
    );

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    return {
      ciphertext: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      salt: salt.toString('hex'),
      version: 1,
    };
  }

  decrypt(payload: EncryptedPayload): string {
    const salt = Buffer.from(payload.salt, 'hex');
    const key = this.deriveKey(salt);
    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');
    const ciphertext = Buffer.from(payload.ciphertext, 'hex');

    const decipher = crypto.createDecipheriv(
      ALGORITHM, key, iv,
      { authTagLength: TAG_LENGTH } as crypto.CipherGCMOptions,
    ) as crypto.DecipherGCM;

    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  async setSecret(serverId: string, key: string, value: string, isSecret = true) {
    const id = crypto.randomUUID();

    if (isSecret) {
      const encrypted = this.encrypt(value);
      await this.db.insert(serverEnvVars).values({
        id,
        serverId,
        key,
        value: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        isSecret: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else {
      await this.db.insert(serverEnvVars).values({
        id,
        serverId,
        key,
        value,
        iv: '',
        tag: '',
        isSecret: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return { id, key, isSecret };
  }

  async getSecret(serverId: string, key: string): Promise<string | null> {
    const all = await this.db.select().from(serverEnvVars);
    const entry = all.find(e => e.serverId === serverId && e.key === key);
    if (!entry) return null;

    if (!entry.isSecret) return entry.value;

    try {
      return this.decrypt({
        ciphertext: entry.value,
        iv: entry.iv,
        tag: entry.tag,
        salt: entry.iv, // For legacy entries that don't have separate salt
        version: 1,
      });
    } catch {
      // If decryption fails (wrong key, corrupted data), return null
      return null;
    }
  }

  async getDecryptedEnvVars(serverId: string): Promise<Record<string, string>> {
    const all = await this.db.select().from(serverEnvVars);
    const entries = all.filter(e => e.serverId === serverId);
    const result: Record<string, string> = {};

    for (const entry of entries) {
      if (!entry.isSecret) {
        result[entry.key] = entry.value;
      } else {
        try {
          result[entry.key] = this.decrypt({
            ciphertext: entry.value,
            iv: entry.iv,
            tag: entry.tag,
            salt: entry.iv,
            version: 1,
          });
        } catch {
          // Skip entries that can't be decrypted
        }
      }
    }

    return result;
  }

  async rotateKey(newMasterSecret: string): Promise<{ rotated: number; failed: number }> {
    const oldService = new SecretsService(this.db, this.masterSecret);
    let rotated = 0;
    let failed = 0;

    const all = await this.db.select().from(serverEnvVars);
    const secrets = all.filter(e => e.isSecret);

    // Update master secret for new encryptions
    this.masterSecret = newMasterSecret;
    this.derivedKey = null;

    for (const entry of secrets) {
      try {
        // Decrypt with old key
        const plaintext = oldService.decrypt({
          ciphertext: entry.value,
          iv: entry.iv,
          tag: entry.tag,
          salt: entry.iv,
          version: 1,
        });

        // Re-encrypt with new key
        const encrypted = this.encrypt(plaintext);

        await this.db.update(serverEnvVars).set({
          value: encrypted.ciphertext,
          iv: encrypted.iv,
          tag: encrypted.tag,
          updatedAt: new Date(),
        }).where(eq(serverEnvVars.id, entry.id));

        rotated++;
      } catch {
        failed++;
      }
    }

    return { rotated, failed };
  }
}
