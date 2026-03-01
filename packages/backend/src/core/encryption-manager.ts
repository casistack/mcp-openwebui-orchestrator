import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface EncryptedData {
  data: string;
  algorithm: string;
  timestamp: string;
}

export interface EncryptionStats {
  algorithm: string;
  keyLength: number;
  masterKeyExists: boolean;
  masterKeyPath: string;
  keyFileExists: boolean;
}

const DEFAULT_KEY_PATH = '/home/mcpuser/.mcp-encryption-key';
const AAD = 'mcp-proxy-manager';

export class EncryptionManager {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32;
  private readonly ivLength = 16;
  private readonly tagLength = 16;
  private readonly masterKeyPath: string;
  private masterKey: Buffer;

  constructor(masterKeyPath = DEFAULT_KEY_PATH) {
    this.masterKeyPath = masterKeyPath;
    this.masterKey = Buffer.alloc(0);
    this.initializeMasterKey();
  }

  private initializeMasterKey(): void {
    try {
      if (fs.existsSync(this.masterKeyPath)) {
        this.masterKey = fs.readFileSync(this.masterKeyPath);
        console.log('Loaded existing encryption master key');
      } else {
        this.masterKey = crypto.randomBytes(this.keyLength);
        const dir = path.dirname(this.masterKeyPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.masterKeyPath, this.masterKey, { mode: 0o600 });
        console.log('Generated new encryption master key');
      }
    } catch (error) {
      console.error('Failed to initialize encryption key:', (error as Error).message);
      this.masterKey = crypto.randomBytes(this.keyLength);
      console.warn('Using temporary encryption key - env vars will be lost on restart!');
    }
  }

  encrypt(plaintext: string): EncryptedData {
    if (!plaintext || typeof plaintext !== 'string') {
      throw new Error('Invalid plaintext for encryption');
    }

    try {
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipheriv(
        this.algorithm, this.masterKey, iv,
        { authTagLength: this.tagLength } as crypto.CipherGCMOptions,
      );
      cipher.setAAD(Buffer.from(AAD));

      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const tag = cipher.getAuthTag();
      const combined = Buffer.concat([iv, encrypted, tag]);

      return {
        data: combined.toString('base64'),
        algorithm: this.algorithm,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Encryption failed:', (error as Error).message);
      throw new Error('Failed to encrypt data');
    }
  }

  decrypt(encryptedData: EncryptedData): string {
    if (!encryptedData?.data) {
      throw new Error('Invalid encrypted data for decryption');
    }

    try {
      const combined = Buffer.from(encryptedData.data, 'base64');
      const iv = combined.subarray(0, this.ivLength);
      const encrypted = combined.subarray(this.ivLength, -this.tagLength);
      const tag = combined.subarray(-this.tagLength);

      const decipher = crypto.createDecipheriv(
        encryptedData.algorithm || this.algorithm,
        this.masterKey,
        iv,
        { authTagLength: this.tagLength } as crypto.CipherGCMOptions,
      ) as crypto.DecipherGCM;
      decipher.setAAD(Buffer.from(AAD));
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted.toString('utf8');
    } catch (error) {
      console.error('Decryption failed:', (error as Error).message);
      throw new Error('Failed to decrypt data - data may be corrupted or key changed');
    }
  }

  hash(value: string): string {
    if (!value || typeof value !== 'string') {
      throw new Error('Invalid value for hashing');
    }

    return crypto
      .createHmac('sha256', this.masterKey)
      .update(value)
      .digest('hex');
  }

  generateToken(length = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  isValidEncryptedData(data: unknown): data is EncryptedData {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const obj = data as Record<string, unknown>;
    return !!(
      obj.data &&
      typeof obj.data === 'string' &&
      obj.algorithm &&
      obj.timestamp
    );
  }

  getStats(): EncryptionStats {
    return {
      algorithm: this.algorithm,
      keyLength: this.keyLength,
      masterKeyExists: !!this.masterKey,
      masterKeyPath: this.masterKeyPath,
      keyFileExists: fs.existsSync(this.masterKeyPath),
    };
  }
}
