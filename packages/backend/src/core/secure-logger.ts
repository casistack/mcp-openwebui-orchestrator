export class SecureLogger {
  private readonly sensitiveKeys: Set<string>;
  private readonly sensitivePatterns: RegExp[];

  constructor() {
    this.sensitiveKeys = new Set([
      'password', 'secret', 'key', 'token', 'credential', 'auth', 'api_key',
      'apikey', 'private_key', 'privatekey', 'access_token', 'refresh_token',
      'bearer', 'jwt', 'oauth', 'session', 'cookie', 'cert', 'certificate',
      'ssl', 'tls', 'hash', 'salt', 'nonce', 'signature', 'passphrase',
    ]);

    this.sensitivePatterns = [
      /sk-[a-zA-Z0-9]{48}/g,
      /xoxb-[a-zA-Z0-9-]{71}/g,
      /ghp_[a-zA-Z0-9]{36}/g,
      /AKIA[0-9A-Z]{16}/g,
      /[a-zA-Z0-9]{40}/g,
      /[a-f0-9]{64}/g,
      /eyJ[a-zA-Z0-9_-]*\./g,
    ];
  }

  maskSensitiveData(data: unknown): unknown {
    if (typeof data === 'string') {
      return this.maskSensitiveString(data);
    }

    if (data === null || data === undefined) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.maskSensitiveData(item));
    }

    if (typeof data === 'object') {
      const masked: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();
        if (this.sensitiveKeys.has(lowerKey) || this.containsSensitiveKeyword(lowerKey)) {
          masked[key] = this.maskValue(value);
        } else {
          masked[key] = this.maskSensitiveData(value);
        }
      }
      return masked;
    }

    return data;
  }

  maskSensitiveString(str: string): string {
    let maskedStr = str;
    for (const pattern of this.sensitivePatterns) {
      // Reset lastIndex since patterns have 'g' flag
      pattern.lastIndex = 0;
      maskedStr = maskedStr.replace(pattern, (match) => {
        if (match.length <= 8) {
          return '*'.repeat(match.length);
        }
        return match.substring(0, 4) + '*'.repeat(match.length - 8) + match.substring(match.length - 4);
      });
    }
    return maskedStr;
  }

  containsSensitiveKeyword(key: string): boolean {
    return Array.from(this.sensitiveKeys).some(sensitive => key.includes(sensitive));
  }

  maskValue(value: unknown): string {
    if (typeof value === 'string') {
      if (value.length <= 4) {
        return '*'.repeat(value.length);
      } else if (value.length <= 8) {
        return value.substring(0, 2) + '*'.repeat(value.length - 2);
      } else {
        return value.substring(0, 4) + '*'.repeat(Math.max(4, value.length - 8)) + value.substring(value.length - 4);
      }
    }
    return '[MASKED]';
  }

  log(message: string, data: unknown = null): void {
    if (data !== null) {
      console.log(message, this.maskSensitiveData(data));
    } else {
      console.log(this.maskSensitiveString(message));
    }
  }

  error(message: string, data: unknown = null): void {
    if (data !== null) {
      console.error(message, this.maskSensitiveData(data));
    } else {
      console.error(this.maskSensitiveString(message));
    }
  }

  warn(message: string, data: unknown = null): void {
    if (data !== null) {
      console.warn(message, this.maskSensitiveData(data));
    } else {
      console.warn(this.maskSensitiveString(message));
    }
  }
}

export const secureLogger = new SecureLogger();
