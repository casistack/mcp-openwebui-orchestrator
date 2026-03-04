export type ErrorCategory = 'auth' | 'connection' | 'resource' | 'dependency' | 'config' | 'runtime';
export type ErrorSeverity = 'low' | 'medium' | 'high';

export interface ClassifiedError {
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
}

const INFORMATIONAL_PATTERNS: RegExp[] = [
  /^INFO:/,
  /Starting .+ on/i,
  /Uvicorn running on/i,
  /Application startup complete/i,
  /Listening on port/i,
  /Building .+ packages/i,
  /Downloading .+\(/i,
  /Installed \d+ packages/i,
  /npm warn/i,
  /npm notice/i,
  /DeprecationWarning/i,
  /ExperimentalWarning/i,
];

const ERROR_PATTERNS: RegExp[] = [
  /ERROR:\s*(.+)/i,
  /Error:\s*(.+)/i,
  /Exception:\s*(.+)/i,
  /RuntimeError:\s*(.+)/i,
  /McpError:\s*(.+)/i,
  /ConnectionError:\s*(.+)/i,
  /\?\s*(.+(?:API key|token|password|username).+)/i,
  /Please enter your\s+(.+)/i,
  /Missing required\s+(.+)/i,
  /Configuration required:\s*(.+)/i,
  /Child exited:\s*(.+)/i,
  /Process .+ with code\s*(\d+)/i,
  /Connection (.+)/i,
  /Failed to connect:\s*(.+)/i,
  /Unable to connect:\s*(.+)/i,
  /Failed to (.+)/i,
  /Cannot (.+)/i,
  /Unable to (.+)/i,
];

const CRITICAL_KEYWORDS = [
  'killed', 'crashed', 'terminated', 'aborted', 'failed', 'error',
  'exception', 'refused', 'timeout', 'unauthorized', 'forbidden',
];

export function isInformationalMessage(output: string): boolean {
  return INFORMATIONAL_PATTERNS.some(pattern => pattern.test(output));
}

function extractErrorMessage(output: string): string | null {
  const cleanOutput = output
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^Child stderr:\s*/i, '')
    .replace(/^Child non-JSON:\s*/i, '')
    .trim();

  for (const pattern of ERROR_PATTERNS) {
    const match = cleanOutput.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  for (const pattern of ERROR_PATTERNS) {
    const match = output.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  const lowerOutput = output.toLowerCase();
  if (CRITICAL_KEYWORDS.some(kw => lowerOutput.includes(kw))) {
    const lines = output.split('\n');
    for (const line of lines) {
      if (CRITICAL_KEYWORDS.some(kw => line.toLowerCase().includes(kw))) {
        return line.trim();
      }
    }
  }

  return null;
}

function categorizeError(errorMessage: string, fullOutput: string): ErrorCategory {
  const lowerMessage = errorMessage.toLowerCase();
  const lowerOutput = fullOutput.toLowerCase();

  if (/api[_\s]*key|token|password|username|auth|login|credential|unauthorized|forbidden|401|403/.test(lowerMessage)) {
    return 'auth';
  }
  if (/connection|connect|network|timeout|refused|closed|host|port|socket|mcperror|runtimeerror.*yield/.test(lowerMessage)) {
    return 'connection';
  }
  if (/memory|killed|resource|space|limit|137|sigkill|oom/.test(lowerMessage) || lowerOutput.includes('code=137')) {
    return 'resource';
  }
  if (/package|dependency|install|build|compile|module|import/.test(lowerMessage)) {
    return 'dependency';
  }
  if (/config|setting|parameter|missing|required|invalid/.test(lowerMessage)) {
    return 'config';
  }
  return 'runtime';
}

function severityForCategory(category: ErrorCategory): ErrorSeverity {
  switch (category) {
    case 'auth': return 'high';
    case 'resource': return 'high';
    case 'connection': return 'medium';
    case 'dependency': return 'medium';
    case 'config': return 'medium';
    case 'runtime': return 'low';
  }
}

export function classifyError(output: string): ClassifiedError | null {
  if (isInformationalMessage(output)) return null;

  const message = extractErrorMessage(output);
  if (!message) return null;

  const category = categorizeError(message, output);
  const severity = severityForCategory(category);

  return { message, category, severity };
}
