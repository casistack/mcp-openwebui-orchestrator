export const ErrorCodes = {
  // Server errors
  SERVER_NOT_FOUND: 'SERVER_NOT_FOUND',
  SERVER_ALREADY_RUNNING: 'SERVER_ALREADY_RUNNING',
  SERVER_START_FAILED: 'SERVER_START_FAILED',
  SERVER_STOP_FAILED: 'SERVER_STOP_FAILED',

  // Config errors
  CONFIG_PARSE_ERROR: 'CONFIG_PARSE_ERROR',
  CONFIG_VALIDATION_ERROR: 'CONFIG_VALIDATION_ERROR',
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',

  // Auth errors
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_INSUFFICIENT_PERMISSIONS: 'AUTH_INSUFFICIENT_PERMISSIONS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_INVALID_API_KEY: 'AUTH_INVALID_API_KEY',

  // Namespace errors
  NAMESPACE_NOT_FOUND: 'NAMESPACE_NOT_FOUND',
  NAMESPACE_SLUG_TAKEN: 'NAMESPACE_SLUG_TAKEN',

  // Endpoint errors
  ENDPOINT_NOT_FOUND: 'ENDPOINT_NOT_FOUND',
  ENDPOINT_SLUG_TAKEN: 'ENDPOINT_SLUG_TAKEN',

  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // General errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  PORT_EXHAUSTED: 'PORT_EXHAUSTED',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export class McpPlatformError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'McpPlatformError';
  }
}
