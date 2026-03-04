import path from 'path';

const ALLOWED_COMMANDS = new Set([
  'npx', 'uvx', 'uv', 'python', 'python3',
  'node', 'npm', 'pip', 'pip3', 'docker',
]);

const DANGEROUS_COMMAND_CHARS = /[;&|`$(){}[\]\\]/;
const NULL_BYTE = /\x00/;
const PATH_TRAVERSAL = /\.\.\//;

export interface ValidationResult {
  valid: boolean;
  command?: string;
  args?: string[];
  error?: string;
}

/**
 * Validates a command string against the allowlist and checks for injection patterns.
 */
export function validateCommand(command: string): ValidationResult {
  if (typeof command !== 'string' || !command.trim()) {
    return { valid: false, error: 'Command must be a non-empty string' };
  }

  const baseCommand = path.basename(command.split(' ')[0]);

  if (!ALLOWED_COMMANDS.has(baseCommand)) {
    return { valid: false, error: `Command "${baseCommand}" is not in the allowed commands list` };
  }

  if (command.includes('..')) {
    return { valid: false, error: 'Command contains path traversal pattern' };
  }

  if (/[;&|]/.test(command)) {
    return { valid: false, error: 'Command contains shell operator characters' };
  }

  if (NULL_BYTE.test(command)) {
    return { valid: false, error: 'Command contains null bytes' };
  }

  return { valid: true, command };
}

/**
 * Validates and sanitizes an array of command arguments.
 */
export function validateArgs(args: unknown[]): ValidationResult {
  if (!Array.isArray(args)) {
    return { valid: false, error: 'Arguments must be an array' };
  }

  if (args.length > 50) {
    return { valid: false, error: `Too many arguments: ${args.length} (max 50)` };
  }

  const sanitized: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== 'string') {
      return { valid: false, error: `Argument at index ${i} must be a string` };
    }

    if (arg.length > 1000) {
      return { valid: false, error: `Argument at index ${i} is too long: ${arg.length} chars (max 1000)` };
    }

    if (DANGEROUS_COMMAND_CHARS.test(arg)) {
      return { valid: false, error: `Argument at index ${i} contains dangerous characters` };
    }

    if (NULL_BYTE.test(arg)) {
      return { valid: false, error: `Argument at index ${i} contains null bytes` };
    }

    if (PATH_TRAVERSAL.test(arg)) {
      return { valid: false, error: `Argument at index ${i} contains path traversal pattern` };
    }

    sanitized.push(arg);
  }

  return { valid: true, args: sanitized };
}

/**
 * Returns the set of allowed commands (for display/documentation purposes).
 */
export function getAllowedCommands(): string[] {
  return [...ALLOWED_COMMANDS];
}

/**
 * Checks if a command is in the allowlist without full validation.
 */
export function isAllowedCommand(command: string): boolean {
  const baseCommand = path.basename(command.split(' ')[0]);
  return ALLOWED_COMMANDS.has(baseCommand);
}
