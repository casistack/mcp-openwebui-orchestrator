import crypto from 'crypto';
import { auditLogs, pipelineSteps as pipelineStepsTable, eq, sql } from '@mcp-platform/db';
import type { AppDatabase } from '@mcp-platform/db';

// A middleware step in the pipeline
export interface PipelineStep {
  id: string;
  name: string;
  type: PipelineStepType;
  config: Record<string, unknown>;
  enabled: boolean;
  order: number;
}

export type PipelineStepType =
  | 'request-logger'
  | 'tool-call-logger'
  | 'rate-limiter'
  | 'content-filter'
  | 'request-transform'
  | 'response-transform'
  | 'header-injector';

// Context passed through the pipeline
export interface PipelineContext {
  requestId: string;
  userId?: string;
  namespaceId: string;
  serverId: string;
  toolName?: string;
  method: string;
  timestamp: number;
  metadata: Record<string, unknown>;
}

// What the pipeline operates on
export interface PipelinePayload {
  headers: Record<string, string>;
  body: unknown;
  toolCall?: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export type PipelineResult =
  | { action: 'continue'; payload: PipelinePayload }
  | { action: 'block'; reason: string; statusCode: number };

export class MiddlewarePipeline {
  private readonly db: AppDatabase;
  // In-memory pipeline configs per namespace
  private pipelines = new Map<string, PipelineStep[]>();
  // Rate limiter state
  private rateLimitBuckets = new Map<string, { count: number; windowStart: number }>();

  constructor(db: AppDatabase) {
    this.db = db;
  }

  setPipeline(namespaceId: string, steps: PipelineStep[]) {
    const sorted = [...steps].sort((a, b) => a.order - b.order);
    this.pipelines.set(namespaceId, sorted);
  }

  getPipeline(namespaceId: string): PipelineStep[] {
    return this.pipelines.get(namespaceId) ?? [];
  }

  async loadPipeline(namespaceId: string): Promise<PipelineStep[]> {
    const rows = await this.db.select().from(pipelineStepsTable);
    const filtered = rows.filter(r => r.namespaceId === namespaceId);
    const steps: PipelineStep[] = filtered.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type as PipelineStepType,
      config: (r.config as Record<string, unknown>) ?? {},
      enabled: r.enabled ?? true,
      order: r.order,
    }));
    steps.sort((a, b) => a.order - b.order);
    this.pipelines.set(namespaceId, steps);
    return steps;
  }

  async loadAllPipelines(): Promise<void> {
    const rows = await this.db.select().from(pipelineStepsTable);
    const byNamespace = new Map<string, PipelineStep[]>();
    for (const r of rows) {
      const step: PipelineStep = {
        id: r.id,
        name: r.name,
        type: r.type as PipelineStepType,
        config: (r.config as Record<string, unknown>) ?? {},
        enabled: r.enabled ?? true,
        order: r.order,
      };
      const list = byNamespace.get(r.namespaceId) ?? [];
      list.push(step);
      byNamespace.set(r.namespaceId, list);
    }
    for (const [ns, steps] of byNamespace) {
      steps.sort((a, b) => a.order - b.order);
      this.pipelines.set(ns, steps);
    }
  }

  async createStep(namespaceId: string, data: {
    name: string;
    type: PipelineStepType;
    config?: Record<string, unknown>;
    enabled?: boolean;
    order?: number;
  }): Promise<PipelineStep> {
    const existing = await this.loadPipeline(namespaceId);
    const step: PipelineStep = {
      id: crypto.randomUUID(),
      name: data.name,
      type: data.type,
      config: data.config ?? {},
      enabled: data.enabled ?? true,
      order: data.order ?? existing.length,
    };
    this.db.insert(pipelineStepsTable).values({
      id: step.id,
      namespaceId,
      name: step.name,
      type: step.type,
      config: step.config,
      enabled: step.enabled,
      order: step.order,
    }).run();
    await this.loadPipeline(namespaceId);
    return step;
  }

  async updateStep(stepId: string, data: {
    name?: string;
    type?: PipelineStepType;
    config?: Record<string, unknown>;
    enabled?: boolean;
    order?: number;
  }): Promise<boolean> {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.config !== undefined) updateData.config = data.config;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.order !== undefined) updateData.order = data.order;
    updateData.updatedAt = new Date();

    if (Object.keys(updateData).length === 0) return false;

    this.db.update(pipelineStepsTable)
      .set(updateData)
      .where(eq(pipelineStepsTable.id, stepId))
      .run();

    // Refresh the cache for the namespace this step belongs to
    const rows = await this.db.select().from(pipelineStepsTable);
    const row = rows.find(r => r.id === stepId);
    if (row) await this.loadPipeline(row.namespaceId);
    return true;
  }

  async deleteStep(stepId: string): Promise<boolean> {
    const rows = await this.db.select().from(pipelineStepsTable);
    const row = rows.find(r => r.id === stepId);
    if (!row) return false;

    this.db.run(sql`DELETE FROM pipeline_steps WHERE id = ${stepId}`);
    await this.loadPipeline(row.namespaceId);
    return true;
  }

  async reorderSteps(namespaceId: string, stepIds: string[]): Promise<void> {
    for (let i = 0; i < stepIds.length; i++) {
      this.db.update(pipelineStepsTable)
        .set({ order: i, updatedAt: new Date() })
        .where(eq(pipelineStepsTable.id, stepIds[i]))
        .run();
    }
    await this.loadPipeline(namespaceId);
  }

  async getStepCount(): Promise<number> {
    const rows = await this.db.select().from(pipelineStepsTable);
    return rows.length;
  }

  async execute(
    namespaceId: string,
    context: PipelineContext,
    payload: PipelinePayload,
  ): Promise<PipelineResult> {
    const steps = this.getPipeline(namespaceId).filter(s => s.enabled);
    let currentPayload = { ...payload };

    for (const step of steps) {
      const result = await this.executeStep(step, context, currentPayload);
      if (result.action === 'block') {
        return result;
      }
      currentPayload = result.payload;
    }

    return { action: 'continue', payload: currentPayload };
  }

  private async executeStep(
    step: PipelineStep,
    context: PipelineContext,
    payload: PipelinePayload,
  ): Promise<PipelineResult> {
    switch (step.type) {
      case 'request-logger':
        return this.stepRequestLogger(step, context, payload);
      case 'tool-call-logger':
        return this.stepToolCallLogger(step, context, payload);
      case 'rate-limiter':
        return this.stepRateLimiter(step, context, payload);
      case 'content-filter':
        return this.stepContentFilter(step, context, payload);
      case 'request-transform':
        return this.stepRequestTransform(step, context, payload);
      case 'response-transform':
        return { action: 'continue', payload };
      case 'header-injector':
        return this.stepHeaderInjector(step, context, payload);
      default:
        return { action: 'continue', payload };
    }
  }

  private async stepRequestLogger(
    _step: PipelineStep,
    context: PipelineContext,
    payload: PipelinePayload,
  ): Promise<PipelineResult> {
    try {
      await this.db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        userId: context.userId ?? null,
        action: 'mcp_request',
        resource: `${context.namespaceId}/${context.serverId}`,
        resourceId: context.requestId,
        details: {
          method: context.method,
          toolName: context.toolName,
          timestamp: context.timestamp,
        },
        ipAddress: null,
        userAgent: null,
        status: 'success',
        durationMs: null,
        createdAt: new Date(),
      });
    } catch {
      // Non-critical
    }
    return { action: 'continue', payload };
  }

  private async stepToolCallLogger(
    _step: PipelineStep,
    context: PipelineContext,
    payload: PipelinePayload,
  ): Promise<PipelineResult> {
    if (!payload.toolCall) {
      return { action: 'continue', payload };
    }
    try {
      await this.db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        userId: context.userId ?? null,
        action: 'tool_call',
        resource: `${context.namespaceId}/${context.serverId}`,
        resourceId: payload.toolCall.name,
        details: {
          toolName: payload.toolCall.name,
          argumentKeys: Object.keys(payload.toolCall.arguments),
        },
        ipAddress: null,
        userAgent: null,
        status: 'success',
        durationMs: null,
        createdAt: new Date(),
      });
    } catch {
      // Non-critical
    }
    return { action: 'continue', payload };
  }

  private stepRateLimiter(
    step: PipelineStep,
    context: PipelineContext,
    payload: PipelinePayload,
  ): PipelineResult {
    const maxRequests = (step.config.maxRequests as number) ?? 100;
    const windowMs = (step.config.windowMs as number) ?? 60_000;
    const keyBy = (step.config.keyBy as string) ?? 'user';

    let bucketKey: string;
    switch (keyBy) {
      case 'tool':
        bucketKey = `${context.namespaceId}:${context.serverId}:${context.toolName ?? 'unknown'}`;
        break;
      case 'namespace':
        bucketKey = context.namespaceId;
        break;
      case 'user':
      default:
        bucketKey = `${context.userId ?? 'anon'}:${context.namespaceId}`;
    }

    const now = Date.now();
    const bucket = this.rateLimitBuckets.get(bucketKey);

    if (!bucket || now - bucket.windowStart > windowMs) {
      this.rateLimitBuckets.set(bucketKey, { count: 1, windowStart: now });
      return { action: 'continue', payload };
    }

    bucket.count++;
    if (bucket.count > maxRequests) {
      return {
        action: 'block',
        reason: `Rate limit exceeded: ${maxRequests} requests per ${windowMs / 1000}s`,
        statusCode: 429,
      };
    }

    return { action: 'continue', payload };
  }

  private stepContentFilter(
    step: PipelineStep,
    _context: PipelineContext,
    payload: PipelinePayload,
  ): PipelineResult {
    const blockedPatterns = (step.config.blockedPatterns as string[]) ?? [];
    const bodyStr = typeof payload.body === 'string'
      ? payload.body
      : JSON.stringify(payload.body);

    for (const pattern of blockedPatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(bodyStr)) {
          return {
            action: 'block',
            reason: `Content blocked by filter: matched pattern "${pattern}"`,
            statusCode: 403,
          };
        }
      } catch {
        // Invalid regex pattern, skip
      }
    }

    return { action: 'continue', payload };
  }

  private stepRequestTransform(
    step: PipelineStep,
    _context: PipelineContext,
    payload: PipelinePayload,
  ): PipelineResult {
    const transforms = step.config.transforms as Array<{
      type: 'set-header' | 'remove-header' | 'set-body-field';
      key: string;
      value?: string;
    }> ?? [];

    const newPayload = { ...payload, headers: { ...payload.headers } };

    for (const transform of transforms) {
      switch (transform.type) {
        case 'set-header':
          if (transform.value) {
            newPayload.headers[transform.key] = transform.value;
          }
          break;
        case 'remove-header':
          delete newPayload.headers[transform.key];
          break;
        case 'set-body-field':
          if (typeof newPayload.body === 'object' && newPayload.body !== null) {
            (newPayload.body as Record<string, unknown>)[transform.key] = transform.value;
          }
          break;
      }
    }

    return { action: 'continue', payload: newPayload };
  }

  private stepHeaderInjector(
    step: PipelineStep,
    _context: PipelineContext,
    payload: PipelinePayload,
  ): PipelineResult {
    const headersToInject = (step.config.headers as Record<string, string>) ?? {};
    const newPayload = {
      ...payload,
      headers: { ...payload.headers, ...headersToInject },
    };
    return { action: 'continue', payload: newPayload };
  }

  // Cleanup stale rate limit buckets periodically
  cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.rateLimitBuckets) {
      if (now - bucket.windowStart > 300_000) {
        this.rateLimitBuckets.delete(key);
      }
    }
  }
}
