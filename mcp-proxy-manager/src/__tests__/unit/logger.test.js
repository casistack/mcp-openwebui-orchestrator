/**
 * Unit tests for logger.js utility
 */
const { logWithTimestamp, logger, getTimestamp } = require('../../logger');

describe('Logger Utility', () => {
  let consoleSpy;

  beforeEach(() => {
    // Spy on console methods
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation()
    };
  });

  afterEach(() => {
    // Restore console methods
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
  });

  describe('getTimestamp', () => {
    test('should return ISO timestamp string', () => {
      const timestamp = getTimestamp();
      
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });

    test('should return different timestamps for consecutive calls', async () => {
      const timestamp1 = getTimestamp();
      await new Promise(resolve => setTimeout(resolve, 1)); // Wait 1ms
      const timestamp2 = getTimestamp();
      
      expect(timestamp1).not.toBe(timestamp2);
    });
  });

  describe('logWithTimestamp', () => {
    test('should log info messages with timestamp prefix', () => {
      const message = 'Test info message';
      logWithTimestamp(message, 'info');

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      const logCall = consoleSpy.log.mock.calls[0][0];
      expect(logCall).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] Test info message$/);
    });

    test('should log error messages with timestamp prefix', () => {
      const message = 'Test error message';
      logWithTimestamp(message, 'error');

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      const logCall = consoleSpy.error.mock.calls[0][0];
      expect(logCall).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] Test error message$/);
    });

    test('should log warn messages with timestamp prefix', () => {
      const message = 'Test warn message';
      logWithTimestamp(message, 'warn');

      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      const logCall = consoleSpy.warn.mock.calls[0][0];
      expect(logCall).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] Test warn message$/);
    });

    test('should log debug messages with DEBUG prefix', () => {
      const message = 'Test debug message';
      logWithTimestamp(message, 'debug');

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      const logCall = consoleSpy.log.mock.calls[0][0];
      expect(logCall).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[DEBUG\] Test debug message$/);
    });

    test('should default to info level when no level specified', () => {
      const message = 'Default level message';
      logWithTimestamp(message);

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      const logCall = consoleSpy.log.mock.calls[0][0];
      expect(logCall).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] Default level message$/);
    });

    test('should handle case-insensitive log levels', () => {
      logWithTimestamp('Test message', 'ERROR');
      logWithTimestamp('Test message', 'WaRn');

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('logger convenience methods', () => {
    test('logger.info should log info messages', () => {
      logger.info('Test info');
      
      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      const logCall = consoleSpy.log.mock.calls[0][0];
      expect(logCall).toMatch(/Test info$/);
    });

    test('logger.error should log error messages', () => {
      logger.error('Test error');
      
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      const logCall = consoleSpy.error.mock.calls[0][0];
      expect(logCall).toMatch(/Test error$/);
    });

    test('logger.warn should log warning messages', () => {
      logger.warn('Test warning');
      
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      const logCall = consoleSpy.warn.mock.calls[0][0];
      expect(logCall).toMatch(/Test warning$/);
    });

    test('logger.debug should log debug messages', () => {
      logger.debug('Test debug');
      
      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      const logCall = consoleSpy.log.mock.calls[0][0];
      expect(logCall).toMatch(/\[DEBUG\] Test debug$/);
    });

    test('logger.log should use specified level', () => {
      logger.log('Test message', 'error');
      
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      const logCall = consoleSpy.error.mock.calls[0][0];
      expect(logCall).toMatch(/Test message$/);
    });

    test('logger.log should default to info level', () => {
      logger.log('Test default');
      
      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      const logCall = consoleSpy.log.mock.calls[0][0];
      expect(logCall).toMatch(/Test default$/);
    });
  });

  describe('timestamp consistency', () => {
    test('should use consistent timestamp format across all methods', () => {
      const timestampRegex = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/;
      
      logger.info('test');
      logger.error('test');
      logger.warn('test');
      logger.debug('test');

      expect(consoleSpy.log.mock.calls[0][0]).toMatch(timestampRegex);
      expect(consoleSpy.error.mock.calls[0][0]).toMatch(timestampRegex);
      expect(consoleSpy.warn.mock.calls[0][0]).toMatch(timestampRegex);
      expect(consoleSpy.log.mock.calls[1][0]).toMatch(timestampRegex);
    });
  });
});