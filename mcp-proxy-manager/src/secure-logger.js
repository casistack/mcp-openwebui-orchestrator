/**
 * Secure logging utility that masks sensitive data
 */
class SecureLogger {
  constructor() {
    // Keywords that indicate sensitive data
    this.sensitiveKeys = new Set([
      'password', 'secret', 'key', 'token', 'credential', 'auth', 'api_key',
      'apikey', 'private_key', 'privatekey', 'access_token', 'refresh_token',
      'bearer', 'jwt', 'oauth', 'session', 'cookie', 'cert', 'certificate',
      'ssl', 'tls', 'hash', 'salt', 'nonce', 'signature', 'passphrase'
    ]);

    // Patterns that indicate sensitive data in strings
    this.sensitivePatterns = [
      /sk-[a-zA-Z0-9]{48}/g,     // OpenAI API keys
      /xoxb-[a-zA-Z0-9-]{71}/g,  // Slack bot tokens
      /ghp_[a-zA-Z0-9]{36}/g,    // GitHub personal access tokens
      /AKIA[0-9A-Z]{16}/g,       // AWS Access Key IDs
      /[a-zA-Z0-9]{40}/g,        // Generic 40-char tokens (GitHub, etc.)
      /[a-f0-9]{64}/g,           // 64-char hex strings (often secrets)
      /eyJ[a-zA-Z0-9_-]*\./g     // JWT tokens (start with eyJ)
    ];
  }

  /**
   * Mask sensitive data in an object
   * @param {Object} data - Data to mask
   * @returns {Object} - Masked data
   */
  maskSensitiveData(data) {
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
      const masked = {};
      for (const [key, value] of Object.entries(data)) {
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

  /**
   * Mask sensitive patterns in a string
   * @param {string} str - String to mask
   * @returns {string} - Masked string
   */
  maskSensitiveString(str) {
    let maskedStr = str;
    for (const pattern of this.sensitivePatterns) {
      maskedStr = maskedStr.replace(pattern, (match) => {
        // Show first 4 and last 4 characters, mask the middle
        if (match.length <= 8) {
          return '*'.repeat(match.length);
        }
        return match.substring(0, 4) + '*'.repeat(match.length - 8) + match.substring(match.length - 4);
      });
    }
    return maskedStr;
  }

  /**
   * Check if a key contains sensitive keywords
   * @param {string} key - Key to check
   * @returns {boolean} - True if sensitive
   */
  containsSensitiveKeyword(key) {
    return Array.from(this.sensitiveKeys).some(sensitive => key.includes(sensitive));
  }

  /**
   * Mask a value appropriately
   * @param {any} value - Value to mask
   * @returns {string} - Masked value
   */
  maskValue(value) {
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

  /**
   * Secure console.log wrapper
   * @param {string} message - Message to log
   * @param {any} data - Optional data to log
   */
  log(message, data = null) {
    if (data !== null) {
      console.log(message, this.maskSensitiveData(data));
    } else {
      console.log(this.maskSensitiveString(message));
    }
  }

  /**
   * Secure console.error wrapper
   * @param {string} message - Error message to log
   * @param {any} data - Optional data to log
   */
  error(message, data = null) {
    if (data !== null) {
      console.error(message, this.maskSensitiveData(data));
    } else {
      console.error(this.maskSensitiveString(message));
    }
  }

  /**
   * Secure console.warn wrapper
   * @param {string} message - Warning message to log
   * @param {any} data - Optional data to log
   */
  warn(message, data = null) {
    if (data !== null) {
      console.warn(message, this.maskSensitiveData(data));
    } else {
      console.warn(this.maskSensitiveString(message));
    }
  }
}

// Export singleton instance
module.exports = new SecureLogger();