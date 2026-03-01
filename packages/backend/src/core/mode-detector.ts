export type ProxyMode = 'individual' | 'unified';

export class ModeDetector {
  private mode: ProxyMode;

  constructor() {
    this.mode = this.detectMode();
  }

  detectMode(): ProxyMode {
    const envMode = process.env.MCP_PROXY_MODE;

    if (!envMode || envMode.toLowerCase() === 'individual') {
      return 'individual';
    }

    if (envMode.toLowerCase() === 'unified') {
      return 'unified';
    }

    console.warn(`Unknown MCP_PROXY_MODE: ${envMode}, defaulting to 'individual'`);
    return 'individual';
  }

  isIndividualMode(): boolean {
    return this.mode === 'individual';
  }

  isUnifiedMode(): boolean {
    return this.mode === 'unified';
  }

  getMode(): ProxyMode {
    return this.mode;
  }

  getModeDescription(): string {
    return this.mode === 'individual'
      ? 'Individual MCPO processes (one per server)'
      : 'Unified MCPO process (single config, route-based)';
  }
}
