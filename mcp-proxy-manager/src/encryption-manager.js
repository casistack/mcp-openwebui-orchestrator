const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class EncryptionManager {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32; // 256 bits
    this.ivLength = 16; // 128 bits
    this.tagLength = 16; // 128 bits
    // Use persistent volume mount for encryption key
    this.masterKeyPath = '/home/mcpuser/.mcp-encryption-key';
    this.masterKey = null;
    
    this.initializeMasterKey();
  }

  initializeMasterKey() {
    try {
      if (fs.existsSync(this.masterKeyPath)) {
        // Load existing master key
        this.masterKey = fs.readFileSync(this.masterKeyPath);
        console.log('Loaded existing encryption master key');
      } else {
        // Generate new master key
        this.masterKey = crypto.randomBytes(this.keyLength);
        
        // Save master key securely
        fs.writeFileSync(this.masterKeyPath, this.masterKey, { mode: 0o600 });
        console.log('Generated new encryption master key');
      }
    } catch (error) {
      console.error('Failed to initialize encryption key:', error.message);
      
      // Fallback: generate temporary key (will be lost on restart)
      this.masterKey = crypto.randomBytes(this.keyLength);
      console.warn('Using temporary encryption key - env vars will be lost on restart!');
    }
  }

  encrypt(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') {
      throw new Error('Invalid plaintext for encryption');
    }

    try {
      // Generate random IV for each encryption
      const iv = crypto.randomBytes(this.ivLength);
      
      // Create cipher
      const cipher = crypto.createCipherGCM(this.algorithm, this.masterKey, iv);
      cipher.setAAD(Buffer.from('mcp-proxy-manager')); // Additional authenticated data
      
      // Encrypt
      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      // Get authentication tag
      const tag = cipher.getAuthTag();
      
      // Combine IV + encrypted data + tag
      const combined = Buffer.concat([iv, encrypted, tag]);
      
      return {
        data: combined.toString('base64'),
        algorithm: this.algorithm,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Encryption failed:', error.message);
      throw new Error('Failed to encrypt data');
    }
  }

  decrypt(encryptedData) {
    if (!encryptedData || !encryptedData.data) {
      throw new Error('Invalid encrypted data for decryption');
    }

    try {
      // Parse base64 data
      const combined = Buffer.from(encryptedData.data, 'base64');
      
      // Extract components
      const iv = combined.subarray(0, this.ivLength);
      const encrypted = combined.subarray(this.ivLength, -this.tagLength);
      const tag = combined.subarray(-this.tagLength);
      
      // Create decipher
      const decipher = crypto.createDecipherGCM(encryptedData.algorithm || this.algorithm, this.masterKey, iv);
      decipher.setAAD(Buffer.from('mcp-proxy-manager'));
      decipher.setAuthTag(tag);
      
      // Decrypt
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return decrypted.toString('utf8');
    } catch (error) {
      console.error('Decryption failed:', error.message);
      throw new Error('Failed to decrypt data - data may be corrupted or key changed');
    }
  }

  /**
   * Securely hash a value for comparison (one-way)
   * @param {string} value - Value to hash
   * @returns {string} - Hash string
   */
  hash(value) {
    if (!value || typeof value !== 'string') {
      throw new Error('Invalid value for hashing');
    }

    return crypto
      .createHmac('sha256', this.masterKey)
      .update(value)
      .digest('hex');
  }

  generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Validate if data appears to be encrypted by this system
   * @param {Object} data - Data to validate
   * @returns {boolean} - True if valid encrypted data
   */
  isValidEncryptedData(data) {
    if (!data || typeof data !== 'object') {
      return false;
    }

    return !!(
      data.data && 
      typeof data.data === 'string' &&
      data.algorithm &&
      data.timestamp
    );
  }

  getStats() {
    return {
      algorithm: this.algorithm,
      keyLength: this.keyLength,
      masterKeyExists: !!this.masterKey,
      masterKeyPath: this.masterKeyPath,
      keyFileExists: fs.existsSync(this.masterKeyPath)
    };
  }
}

module.exports = EncryptionManager;