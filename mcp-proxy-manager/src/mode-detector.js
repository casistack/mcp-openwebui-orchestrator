/**
 * Mode Detection for MCP Proxy Manager
 * Determines whether to use individual proxies or unified MCPO mode
 */

class ModeDetector {
  constructor() {
    this.mode = this.detectMode();
  }

  detectMode() {
    const envMode = process.env.MCP_PROXY_MODE;
    
    // Default to individual mode for backward compatibility
    if (!envMode || envMode.toLowerCase() === 'individual') {
      return 'individual';
    }
    
    if (envMode.toLowerCase() === 'unified') {
      return 'unified';
    }
    
    console.warn(`Unknown MCP_PROXY_MODE: ${envMode}, defaulting to 'individual'`);
    return 'individual';
  }

  isIndividualMode() {
    return this.mode === 'individual';
  }

  isUnifiedMode() {
    return this.mode === 'unified';
  }

  getMode() {
    return this.mode;
  }

  getModeDescription() {
    return this.mode === 'individual' 
      ? 'Individual MCPO processes (one per server)'
      : 'Unified MCPO process (single config, route-based)';
  }
}

module.exports = ModeDetector;