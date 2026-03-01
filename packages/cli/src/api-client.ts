import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.mcp-platform');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface CLIConfig {
  baseUrl: string;
  apiKey?: string;
  sessionCookie?: string;
}

function loadConfig(): CLIConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { baseUrl: 'http://localhost:3001' };
  }
}

function saveConfig(config: CLIConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  fs.chmodSync(CONFIG_FILE, 0o600);
}

export function getConfig(): CLIConfig {
  return loadConfig();
}

export function setBaseUrl(url: string): void {
  const config = loadConfig();
  config.baseUrl = url;
  saveConfig(config);
}

export function setApiKey(key: string): void {
  const config = loadConfig();
  config.apiKey = key;
  delete config.sessionCookie;
  saveConfig(config);
}

export function setSessionCookie(cookie: string): void {
  const config = loadConfig();
  config.sessionCookie = cookie;
  delete config.apiKey;
  saveConfig(config);
}

export function clearAuth(): void {
  const config = loadConfig();
  delete config.apiKey;
  delete config.sessionCookie;
  saveConfig(config);
}

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const config = loadConfig();
  const url = `${config.baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  } else if (config.sessionCookie) {
    headers['Cookie'] = config.sessionCookie;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    let msg: string;
    try {
      const json = JSON.parse(text);
      msg = json.error || json.message || text;
    } catch {
      msg = text;
    }
    throw new Error(`${res.status} ${res.statusText}: ${msg}`);
  }

  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text);
}

export const api = {
  get: (path: string) => request('GET', path),
  post: (path: string, body?: unknown) => request('POST', path, body),
  put: (path: string, body?: unknown) => request('PUT', path, body),
  delete: (path: string) => request('DELETE', path),
};
