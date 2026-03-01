import { jest } from '@jest/globals';
import { createMockDatabase, mockTables, type MockDatabase } from './mock-db.js';

jest.unstable_mockModule('@mcp-platform/db', () => ({
  ...mockTables,
  createDatabase: jest.fn(),
}));

const { MiddlewarePipeline } = await import('../services/middleware-pipeline.js');
type PipelineStep = import('../services/middleware-pipeline.js').PipelineStep;
type PipelineContext = import('../services/middleware-pipeline.js').PipelineContext;
type PipelinePayload = import('../services/middleware-pipeline.js').PipelinePayload;

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    requestId: 'req-1',
    userId: 'user-1',
    namespaceId: 'ns-1',
    serverId: 'srv-1',
    method: 'tools/call',
    timestamp: Date.now(),
    metadata: {},
    ...overrides,
  };
}

function makePayload(overrides?: Partial<PipelinePayload>): PipelinePayload {
  return {
    headers: { 'content-type': 'application/json' },
    body: { data: 'test' },
    ...overrides,
  };
}

function makeStep(type: PipelineStep['type'], config: Record<string, unknown> = {}, order = 0): PipelineStep {
  return {
    id: `step-${type}-${order}`,
    name: type,
    type,
    config,
    enabled: true,
    order,
  };
}

describe('MiddlewarePipeline', () => {
  let db: MockDatabase;
  let pipeline: InstanceType<typeof MiddlewarePipeline>;

  beforeEach(() => {
    db = createMockDatabase();
    pipeline = new MiddlewarePipeline(db as never);
  });

  describe('setPipeline / getPipeline', () => {
    it('should store and retrieve pipeline steps', () => {
      const steps = [
        makeStep('rate-limiter', {}, 1),
        makeStep('request-logger', {}, 0),
      ];

      pipeline.setPipeline('ns-1', steps);
      const retrieved = pipeline.getPipeline('ns-1');

      // Should be sorted by order
      expect(retrieved).toHaveLength(2);
      expect(retrieved[0].type).toBe('request-logger');
      expect(retrieved[1].type).toBe('rate-limiter');
    });

    it('should return empty array for unconfigured namespace', () => {
      expect(pipeline.getPipeline('missing')).toEqual([]);
    });
  });

  describe('execute - empty pipeline', () => {
    it('should pass through when no steps configured', async () => {
      const ctx = makeContext();
      const payload = makePayload();

      const result = await pipeline.execute('ns-1', ctx, payload);
      expect(result.action).toBe('continue');
      if (result.action === 'continue') {
        expect(result.payload.body).toEqual({ data: 'test' });
      }
    });
  });

  describe('request-logger step', () => {
    it('should log to audit_logs and continue', async () => {
      pipeline.setPipeline('ns-1', [makeStep('request-logger')]);
      const result = await pipeline.execute('ns-1', makeContext(), makePayload());

      expect(result.action).toBe('continue');
      const logs = db._getTable('audit_logs');
      expect(logs).toHaveLength(1);
      expect((logs[0] as { action: string }).action).toBe('mcp_request');
    });
  });

  describe('tool-call-logger step', () => {
    it('should log tool calls to audit_logs', async () => {
      pipeline.setPipeline('ns-1', [makeStep('tool-call-logger')]);
      const payload = makePayload({
        toolCall: { name: 'search', arguments: { query: 'test' } },
      });

      const result = await pipeline.execute('ns-1', makeContext(), payload);
      expect(result.action).toBe('continue');

      const logs = db._getTable('audit_logs');
      expect(logs).toHaveLength(1);
      expect((logs[0] as { action: string }).action).toBe('tool_call');
      expect((logs[0] as { resourceId: string }).resourceId).toBe('search');
    });

    it('should skip logging when no tool call present', async () => {
      pipeline.setPipeline('ns-1', [makeStep('tool-call-logger')]);
      await pipeline.execute('ns-1', makeContext(), makePayload());

      const logs = db._getTable('audit_logs');
      expect(logs).toHaveLength(0);
    });
  });

  describe('rate-limiter step', () => {
    it('should allow requests under limit', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('rate-limiter', { maxRequests: 5, windowMs: 60000 }),
      ]);

      for (let i = 0; i < 5; i++) {
        const result = await pipeline.execute('ns-1', makeContext(), makePayload());
        expect(result.action).toBe('continue');
      }
    });

    it('should block requests over limit', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('rate-limiter', { maxRequests: 2, windowMs: 60000 }),
      ]);

      await pipeline.execute('ns-1', makeContext(), makePayload());
      await pipeline.execute('ns-1', makeContext(), makePayload());
      const result = await pipeline.execute('ns-1', makeContext(), makePayload());

      expect(result.action).toBe('block');
      if (result.action === 'block') {
        expect(result.statusCode).toBe(429);
        expect(result.reason).toContain('Rate limit exceeded');
      }
    });

    it('should separate rate limits by user', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('rate-limiter', { maxRequests: 1, windowMs: 60000, keyBy: 'user' }),
      ]);

      const r1 = await pipeline.execute('ns-1', makeContext({ userId: 'user-a' }), makePayload());
      const r2 = await pipeline.execute('ns-1', makeContext({ userId: 'user-b' }), makePayload());

      expect(r1.action).toBe('continue');
      expect(r2.action).toBe('continue');
    });

    it('should support keying by namespace', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('rate-limiter', { maxRequests: 1, windowMs: 60000, keyBy: 'namespace' }),
      ]);

      await pipeline.execute('ns-1', makeContext({ userId: 'user-a' }), makePayload());
      const r2 = await pipeline.execute('ns-1', makeContext({ userId: 'user-b' }), makePayload());

      // Same namespace, different user - should still be blocked
      expect(r2.action).toBe('block');
    });
  });

  describe('content-filter step', () => {
    it('should pass through allowed content', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('content-filter', { blockedPatterns: ['password', 'credit.card'] }),
      ]);

      const result = await pipeline.execute(
        'ns-1',
        makeContext(),
        makePayload({ body: { query: 'search for documents' } }),
      );
      expect(result.action).toBe('continue');
    });

    it('should block content matching a pattern', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('content-filter', { blockedPatterns: ['password', 'credit.card'] }),
      ]);

      const result = await pipeline.execute(
        'ns-1',
        makeContext(),
        makePayload({ body: { query: 'find my password reset' } }),
      );

      expect(result.action).toBe('block');
      if (result.action === 'block') {
        expect(result.statusCode).toBe(403);
        expect(result.reason).toContain('password');
      }
    });

    it('should handle regex patterns', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('content-filter', { blockedPatterns: ['\\d{4}-\\d{4}-\\d{4}-\\d{4}'] }),
      ]);

      const result = await pipeline.execute(
        'ns-1',
        makeContext(),
        makePayload({ body: 'card number is 1234-5678-9012-3456' }),
      );

      expect(result.action).toBe('block');
    });

    it('should skip invalid regex patterns gracefully', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('content-filter', { blockedPatterns: ['[invalid regex', 'valid-word'] }),
      ]);

      const result = await pipeline.execute(
        'ns-1',
        makeContext(),
        makePayload({ body: 'this is safe content' }),
      );
      expect(result.action).toBe('continue');
    });
  });

  describe('header-injector step', () => {
    it('should inject headers', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('header-injector', { headers: { 'X-Custom': 'injected', 'X-Source': 'platform' } }),
      ]);

      const result = await pipeline.execute('ns-1', makeContext(), makePayload());
      expect(result.action).toBe('continue');
      if (result.action === 'continue') {
        expect(result.payload.headers['X-Custom']).toBe('injected');
        expect(result.payload.headers['X-Source']).toBe('platform');
        // Original headers preserved
        expect(result.payload.headers['content-type']).toBe('application/json');
      }
    });
  });

  describe('request-transform step', () => {
    it('should set headers', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('request-transform', {
          transforms: [{ type: 'set-header', key: 'Authorization', value: 'Bearer token123' }],
        }),
      ]);

      const result = await pipeline.execute('ns-1', makeContext(), makePayload());
      if (result.action === 'continue') {
        expect(result.payload.headers['Authorization']).toBe('Bearer token123');
      }
    });

    it('should remove headers', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('request-transform', {
          transforms: [{ type: 'remove-header', key: 'content-type' }],
        }),
      ]);

      const result = await pipeline.execute('ns-1', makeContext(), makePayload());
      if (result.action === 'continue') {
        expect(result.payload.headers).not.toHaveProperty('content-type');
      }
    });

    it('should set body fields', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('request-transform', {
          transforms: [{ type: 'set-body-field', key: 'injected', value: 'yes' }],
        }),
      ]);

      const result = await pipeline.execute(
        'ns-1',
        makeContext(),
        makePayload({ body: { existing: 'data' } }),
      );

      if (result.action === 'continue') {
        expect((result.payload.body as Record<string, unknown>).injected).toBe('yes');
        expect((result.payload.body as Record<string, unknown>).existing).toBe('data');
      }
    });
  });

  describe('multi-step pipeline', () => {
    it('should execute steps in order', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('header-injector', { headers: { 'X-Step': '1' } }, 0),
        makeStep('request-logger', {}, 1),
      ]);

      const result = await pipeline.execute('ns-1', makeContext(), makePayload());
      expect(result.action).toBe('continue');

      // Header was injected
      if (result.action === 'continue') {
        expect(result.payload.headers['X-Step']).toBe('1');
      }
      // Logger logged
      expect(db._getTable('audit_logs')).toHaveLength(1);
    });

    it('should stop pipeline on block', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('content-filter', { blockedPatterns: ['blocked-word'] }, 0),
        makeStep('request-logger', {}, 1),
      ]);

      const result = await pipeline.execute(
        'ns-1',
        makeContext(),
        makePayload({ body: 'contains blocked-word here' }),
      );

      expect(result.action).toBe('block');
      // Logger should NOT have been called (pipeline stopped)
      expect(db._getTable('audit_logs')).toHaveLength(0);
    });

    it('should skip disabled steps', async () => {
      const disabledStep = makeStep('content-filter', { blockedPatterns: ['everything'] }, 0);
      disabledStep.enabled = false;

      pipeline.setPipeline('ns-1', [disabledStep]);

      const result = await pipeline.execute(
        'ns-1',
        makeContext(),
        makePayload({ body: 'everything matches' }),
      );

      expect(result.action).toBe('continue');
    });
  });

  describe('cleanup', () => {
    it('should remove stale rate limit buckets', async () => {
      pipeline.setPipeline('ns-1', [
        makeStep('rate-limiter', { maxRequests: 100, windowMs: 1000 }),
      ]);

      // Generate some rate limit entries
      await pipeline.execute('ns-1', makeContext(), makePayload());

      // Cleanup shouldn't crash
      pipeline.cleanup();
    });
  });
});
