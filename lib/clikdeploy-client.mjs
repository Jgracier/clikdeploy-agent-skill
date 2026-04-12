import os from 'node:os';

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token || !token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function normalizeApiUrl(value) {
  if (!value || typeof value !== 'string') return 'https://clikdeploy.com';
  return value.trim().replace(/\/+$/, '');
}

export function requireArg(args, key) {
  const value = args[key];
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required argument: --${key}`);
  }
  return String(value);
}

export function safeJsonParse(raw, fallback = {}) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function getCliOauthConsentUrl(apiUrl, provider, { port, callbackUrl } = {}) {
  const p = String(provider || '').toLowerCase();
  if (p !== 'google' && p !== 'github') {
    throw new Error('Provider must be google or github');
  }

  const base = normalizeApiUrl(apiUrl);
  const params = new URLSearchParams();
  if (port !== undefined && port !== null && String(port).trim() !== '') {
    params.set('port', String(port).trim());
  }
  if (callbackUrl !== undefined && callbackUrl !== null && String(callbackUrl).trim() !== '') {
    params.set('callbackUrl', String(callbackUrl).trim());
  }

  const path = `/api/auth/cli/${p}`;
  const requestUrl = `${base}${path}${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'manual',
  });

  const location = response.headers.get('location');
  if (response.status >= 300 && response.status < 400 && location) {
    return new URL(location, base).toString();
  }

  const text = await response.text();
  const parsed = safeJsonParse(text, { raw: text });
  if (!response.ok) {
    const msg =
      (parsed && typeof parsed.error === 'string' && parsed.error) ||
      (parsed && parsed.message) ||
      `OAuth URL request failed (${response.status})`;
    throw new Error(String(msg));
  }

  if (parsed && typeof parsed.authUrl === 'string' && parsed.authUrl.trim().length > 0) {
    return parsed.authUrl.trim();
  }

  throw new Error(`OAuth consent URL missing for provider: ${p}`);
}

export async function startDeviceOAuth(apiUrl, provider) {
  const p = String(provider || '').toLowerCase();
  if (p !== 'google' && p !== 'github') {
    throw new Error('Provider must be google or github');
  }

  const response = await fetch(`${normalizeApiUrl(apiUrl)}/api/auth/cli/device/init`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ provider: p }),
  });

  const text = await response.text();
  const parsed = safeJsonParse(text, { raw: text });
  if (!response.ok) {
    const msg =
      (parsed && typeof parsed.error === 'string' && parsed.error) ||
      (parsed && parsed.message) ||
      `Device OAuth init failed (${response.status})`;
    throw new Error(String(msg));
  }

  const data = parsed?.data || parsed;
  const authUrl = data?.authUrl;
  if (!authUrl || typeof authUrl !== 'string') {
    throw new Error(`Device OAuth init missing authUrl for provider: ${p}`);
  }

  return {
    provider: p,
    flowId: data?.flowId || null,
    authUrl,
    expiresInSec: Number(data?.expiresInSec || 0) || null,
  };
}

export async function exchangeDeviceOAuthCode(apiUrl, code) {
  const normalized = String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!normalized) {
    throw new Error('One-time code is required');
  }

  const response = await fetch(`${normalizeApiUrl(apiUrl)}/api/auth/cli/device/exchange`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code: normalized }),
  });

  const text = await response.text();
  const parsed = safeJsonParse(text, { raw: text });
  if (!response.ok) {
    const msg =
      (parsed && typeof parsed.error === 'string' && parsed.error) ||
      (parsed && parsed.message) ||
      `Device OAuth exchange failed (${response.status})`;
    throw new Error(String(msg));
  }

  const data = parsed?.data || parsed;
  const apiKey = data?.apiKey;
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('Device OAuth exchange succeeded but apiKey was not returned');
  }

  return {
    apiKey,
    code: normalized,
  };
}

function normalizeCollectionPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && Array.isArray(payload.data.items)) return payload.data.items;
  if (payload.data && Array.isArray(payload.data.servers)) return payload.data.servers;
  if (payload.data && Array.isArray(payload.data.apps)) return payload.data.apps;
  if (payload.data && Array.isArray(payload.data.deployments)) return payload.data.deployments;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.servers)) return payload.servers;
  if (Array.isArray(payload.apps)) return payload.apps;
  if (Array.isArray(payload.deployments)) return payload.deployments;
  return [];
}

function normalizeObjectPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    if (payload.data.app && typeof payload.data.app === 'object') return payload.data.app;
    if (payload.data.server && typeof payload.data.server === 'object') return payload.data.server;
    if (payload.data.deployment && typeof payload.data.deployment === 'object') return payload.data.deployment;
    return payload.data;
  }
  return payload;
}

export async function apiRequest(apiUrl, apiKey, path, { method = 'GET', body } = {}) {
  const url = `${normalizeApiUrl(apiUrl)}${path}`;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const parsed = safeJsonParse(text, { raw: text });

  if (!response.ok) {
    const errorMessage =
      (parsed && typeof parsed.error === 'string' && parsed.error) ||
      (parsed && parsed.message) ||
      `Request failed (${response.status})`;
    const error = new Error(String(errorMessage));
    error.status = response.status;
    error.payload = parsed;
    throw error;
  }

  return parsed;
}

export async function getServers(apiUrl, apiKey) {
  const payload = await apiRequest(apiUrl, apiKey, '/api/servers?page=1&pageSize=100');
  return normalizeCollectionPayload(payload);
}

export async function getApp(apiUrl, apiKey, appId) {
  const payload = await apiRequest(apiUrl, apiKey, `/api/apps/${appId}`);
  return normalizeObjectPayload(payload);
}

export async function getDeployments(apiUrl, apiKey, appId) {
  const payload = await apiRequest(
    apiUrl,
    apiKey,
    `/api/apps/${appId}/deployments?page=1&pageSize=50`
  );
  return normalizeCollectionPayload(payload);
}

export async function getMarketplaceApps(apiUrl, apiKey) {
  const url = `${normalizeApiUrl(apiUrl)}/api/marketplace`;
  const headers = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(url, { method: 'GET', headers });
  const text = await response.text();
  const parsed = safeJsonParse(text, { raw: text });
  if (!response.ok) {
    const msg =
      (parsed && typeof parsed.error === 'string' && parsed.error) ||
      (parsed && parsed.message) ||
      `Request failed (${response.status})`;
    throw new Error(String(msg));
  }
  return normalizeCollectionPayload(parsed);
}

export function marketplacePopularityScore(app) {
  const stats =
    app && app.deployStats && typeof app.deployStats === 'object'
      ? app.deployStats
      : { succeeded: 0, failed: 0, recovered: 0 };

  const succeeded = Number(stats.succeeded || 0);
  const failed = Number(stats.failed || 0);
  const recovered = Number(stats.recovered || 0);
  return succeeded * 2 + recovered - failed * 0.5;
}

export function getPopularMarketplaceSuggestions(apps, limit = 8) {
  if (!Array.isArray(apps)) return [];

  return [...apps]
    .sort((a, b) => {
      const scoreDelta = marketplacePopularityScore(b) - marketplacePopularityScore(a);
      if (scoreDelta !== 0) return scoreDelta;
      const featuredDelta = Number(Boolean(b?.featured)) - Number(Boolean(a?.featured));
      if (featuredDelta !== 0) return featuredDelta;
      return String(a?.name || '').localeCompare(String(b?.name || ''));
    })
    .slice(0, limit)
    .map((app) => ({
      id: app?.id || null,
      name: app?.name || null,
      dockerImage: app?.dockerImage || null,
      description: app?.shortDescription || app?.description || null,
      featured: Boolean(app?.featured),
      deployStats: app?.deployStats || { succeeded: 0, failed: 0, recovered: 0 },
      popularityScore: marketplacePopularityScore(app),
    }));
}

export function preferHomeAgentServer(servers, explicitServer) {
  if (!Array.isArray(servers) || servers.length === 0) {
    throw new Error('No servers available for this account.');
  }

  if (explicitServer) {
    const needle = String(explicitServer).toLowerCase();
    const match = servers.find((server) => {
      const id = String(server.id || '').toLowerCase();
      const name = String(server.name || '').toLowerCase();
      return id === needle || name === needle;
    });
    if (!match) {
      throw new Error(`Server not found: ${explicitServer}`);
    }
    return match;
  }

  const connected = servers.filter((server) => String(server.status || '').toUpperCase() === 'CONNECTED');
  const pool = connected.length > 0 ? connected : servers;

  const homeAgent = pool.find((server) => {
    const provider = String(server.cloudProvider || '').toUpperCase();
    const connectionType = String(server.connectionType || '').toUpperCase();
    return provider === 'HOME' || connectionType === 'AGENT';
  });

  return homeAgent || pool[0];
}

export function defaultMachineName(customName) {
  if (customName && String(customName).trim().length > 0) return String(customName).trim();
  return `${os.hostname()} (Home)`;
}

export function buildLinuxInstallerCommand(apiUrl, token, serverId, agentId) {
  const base = normalizeApiUrl(apiUrl);
  return `curl -fsSL \"${base}/install.sh\" | bash -s -- --token \"${token}\" --server-id \"${serverId}\" --agent-id \"${agentId}\" --server \"${base}\"`;
}

export function buildWindowsInstallerCommand(apiUrl, token, serverId, agentId) {
  const base = normalizeApiUrl(apiUrl);
  return `(irm \"${base}/install.ps1\") | iex; Install-ClikDeployAgent -Token '${token}' -ServerId '${serverId}' -AgentId '${agentId}' -ServerUrl '${base}'`;
}

export function slugifyAppName(value) {
  return String(value || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'app';
}

export function inferAppNameFromImage(image) {
  const raw = String(image || 'app');
  const withoutTag = raw.split(':')[0];
  const finalSegment = withoutTag.split('/').filter(Boolean).pop() || 'app';
  return slugifyAppName(finalSegment);
}

export function toEnvObject(envArgs) {
  const env = {};
  for (const item of envArgs) {
    if (!item.includes('=')) continue;
    const idx = item.indexOf('=');
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1);
    if (!key) continue;
    env[key] = value;
  }
  return env;
}

export function buildFallbackUrl(server, app) {
  const domain = app && typeof app.domain === 'string' ? app.domain.trim() : '';
  if (domain) return `https://${domain}`;

  const ip = server && typeof server.ipAddress === 'string' ? server.ipAddress.trim() : '';
  if (!ip) return null;

  const port = Number(app?.port || 80);
  if (port === 80) return `http://${ip}`;
  if (port === 443) return `https://${ip}`;
  return `http://${ip}:${port}`;
}

export async function searchDockerHub(apiUrl, query, { page = 1, limit = 25 } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Docker Hub query is required');

  const url =
    `${normalizeApiUrl(apiUrl)}/api/docker-hub/search` +
    `?q=${encodeURIComponent(q)}&page=${encodeURIComponent(String(page))}&limit=${encodeURIComponent(String(limit))}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  const parsed = safeJsonParse(text, { raw: text });
  if (!response.ok) {
    const msg =
      (parsed && typeof parsed.error === 'string' && parsed.error) ||
      (parsed && parsed.message) ||
      `Request failed (${response.status})`;
    throw new Error(String(msg));
  }
  return normalizeCollectionPayload(parsed);
}

export function pickBestDockerHubImage(images) {
  if (!Array.isArray(images) || images.length === 0) return null;

  const ranked = [...images].sort((a, b) => {
    const pullA = Number(a?.pull_count || 0);
    const pullB = Number(b?.pull_count || 0);
    if (pullB !== pullA) return pullB - pullA;

    const starA = Number(a?.star_count || 0);
    const starB = Number(b?.star_count || 0);
    if (starB !== starA) return starB - starA;

    const trustedA = Number(Boolean(a?.is_trusted));
    const trustedB = Number(Boolean(b?.is_trusted));
    if (trustedB !== trustedA) return trustedB - trustedA;

    const officialA = Number(Boolean(a?.official));
    const officialB = Number(Boolean(b?.official));
    if (officialB !== officialA) return officialB - officialA;

    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });

  return ranked[0] || null;
}
