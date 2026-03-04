import { validateCommand, validateArgs, getAllowedCommands, isAllowedCommand } from '../core/command-validator.js';

describe('CommandValidator', () => {
  describe('validateCommand', () => {
    it('should accept allowed commands', () => {
      expect(validateCommand('npx').valid).toBe(true);
      expect(validateCommand('uvx').valid).toBe(true);
      expect(validateCommand('node').valid).toBe(true);
      expect(validateCommand('python').valid).toBe(true);
      expect(validateCommand('python3').valid).toBe(true);
      expect(validateCommand('docker').valid).toBe(true);
      expect(validateCommand('npm').valid).toBe(true);
      expect(validateCommand('pip').valid).toBe(true);
      expect(validateCommand('pip3').valid).toBe(true);
      expect(validateCommand('uv').valid).toBe(true);
    });

    it('should reject disallowed commands', () => {
      const result = validateCommand('curl');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not in the allowed commands list');
    });

    it('should reject empty or non-string input', () => {
      expect(validateCommand('').valid).toBe(false);
      expect(validateCommand('  ').valid).toBe(false);
    });

    it('should reject path traversal', () => {
      const result = validateCommand('npx ../../../bin/malicious');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('path traversal');
    });

    it('should reject shell operators', () => {
      expect(validateCommand('npx; rm -rf /').valid).toBe(false);
      expect(validateCommand('npx & echo bad').valid).toBe(false);
      expect(validateCommand('npx | cat /etc/passwd').valid).toBe(false);
    });

    it('should reject null bytes', () => {
      expect(validateCommand('npx\x00malicious').valid).toBe(false);
    });

    it('should handle commands with full path', () => {
      expect(validateCommand('/usr/bin/npx').valid).toBe(true);
      expect(validateCommand('/usr/local/bin/node').valid).toBe(true);
    });
  });

  describe('validateArgs', () => {
    it('should accept valid args', () => {
      const result = validateArgs(['-y', '@modelcontextprotocol/server-memory']);
      expect(result.valid).toBe(true);
      expect(result.args).toEqual(['-y', '@modelcontextprotocol/server-memory']);
    });

    it('should reject non-array input', () => {
      expect(validateArgs('bad' as unknown as unknown[]).valid).toBe(false);
    });

    it('should reject too many arguments', () => {
      const args = Array.from({ length: 51 }, (_, i) => `arg${i}`);
      const result = validateArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Too many arguments');
    });

    it('should reject arguments that are too long', () => {
      const result = validateArgs(['x'.repeat(1001)]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too long');
    });

    it('should reject dangerous characters in args', () => {
      expect(validateArgs(['--flag; rm -rf /']).valid).toBe(false);
      expect(validateArgs(['$(whoami)']).valid).toBe(false);
      expect(validateArgs(['`id`']).valid).toBe(false);
    });

    it('should reject null bytes in args', () => {
      expect(validateArgs(['valid', 'bad\x00arg']).valid).toBe(false);
    });

    it('should reject path traversal in args', () => {
      expect(validateArgs(['../../etc/passwd']).valid).toBe(false);
    });

    it('should reject non-string args', () => {
      expect(validateArgs([123 as unknown as string]).valid).toBe(false);
    });

    it('should accept empty args array', () => {
      const result = validateArgs([]);
      expect(result.valid).toBe(true);
      expect(result.args).toEqual([]);
    });
  });

  describe('getAllowedCommands', () => {
    it('should return a non-empty array', () => {
      const cmds = getAllowedCommands();
      expect(cmds.length).toBeGreaterThan(0);
      expect(cmds).toContain('npx');
      expect(cmds).toContain('uvx');
    });
  });

  describe('isAllowedCommand', () => {
    it('should return true for allowed commands', () => {
      expect(isAllowedCommand('npx')).toBe(true);
      expect(isAllowedCommand('/usr/bin/node')).toBe(true);
    });

    it('should return false for disallowed commands', () => {
      expect(isAllowedCommand('wget')).toBe(false);
      expect(isAllowedCommand('bash')).toBe(false);
    });
  });
});
