export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export function getTimestamp(): string {
  return new Date().toISOString();
}

export function logWithTimestamp(message: string, level: LogLevel = 'info'): void {
  const timestamp = getTimestamp();
  const prefix = `[${timestamp}]`;

  switch (level) {
    case 'error':
      console.error(`${prefix} ${message}`);
      break;
    case 'warn':
      console.warn(`${prefix} ${message}`);
      break;
    case 'debug':
      console.log(`${prefix} [DEBUG] ${message}`);
      break;
    default:
      console.log(`${prefix} ${message}`);
  }
}

export const logger = {
  info: (message: string): void => logWithTimestamp(message, 'info'),
  warn: (message: string): void => logWithTimestamp(message, 'warn'),
  error: (message: string): void => logWithTimestamp(message, 'error'),
  debug: (message: string): void => logWithTimestamp(message, 'debug'),
  log: (message: string, level: LogLevel = 'info'): void => logWithTimestamp(message, level),
};
