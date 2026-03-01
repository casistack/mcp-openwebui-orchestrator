export class MCPError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;
  readonly timestamp: string;

  constructor(message: string, code = 'MCP_ERROR', context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'MCPError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}

export interface LogContext {
  serverId?: string;
  [key: string]: unknown;
}

export class Logger {
  static error(message: string, error: Error | null = null, context: LogContext = {}): void {
    console.error(`${message}`, context.serverId ? `[${context.serverId}]` : '');
    if (error?.stack) {
      console.error('Stack:', error.stack);
    }
  }

  static warn(message: string, context: LogContext = {}): void {
    console.warn(`${message}`, context.serverId ? `[${context.serverId}]` : '');
  }

  static info(message: string, context: LogContext = {}): void {
    console.log(`${message}`, context.serverId ? `[${context.serverId}]` : '');
  }

  static success(message: string, context: LogContext = {}): void {
    console.log(`${message}`, context.serverId ? `[${context.serverId}]` : '');
  }
}

export const ErrorCodes = {
  CONFIG_ERROR: 'CONFIG_ERROR',
  PROXY_START_ERROR: 'PROXY_START_ERROR',
  PROXY_HEALTH_ERROR: 'PROXY_HEALTH_ERROR',
  PORT_ALLOCATION_ERROR: 'PORT_ALLOCATION_ERROR',
  INSTALLATION_ERROR: 'INSTALLATION_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
