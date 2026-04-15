#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_API_URL = 'https://clikdeploy.com';

function resolveConfigHome() {
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function authPaths() {
  return {
    authJsonPath: path.join(resolveConfigHome(), 'clikdeploy', 'auth.json'),
    apiKeyPath: path.join(os.homedir(), '.clikdeploy', 'api-key'),
  };
}

function selfHostConfigPath() {
  return path.join(os.homedir(), '.clikdeploy', 'self-host.json');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function loadAuth() {
  const { authJsonPath, apiKeyPath } = authPaths();
  try {
    if (fs.existsSync(authJsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(authJsonPath, 'utf8'));
      const apiUrl = String(parsed?.apiUrl || '').trim() || DEFAULT_API_URL;
      const apiKey = String(parsed?.apiKey || '').trim();
      const authMethod = String(parsed?.authMethod || 'unknown').trim().toLowerCase() || 'unknown';
      if (apiKey) return { apiUrl, apiKey, authMethod };
    }
  } catch {
    // fall through to key file
  }

  try {
    if (fs.existsSync(apiKeyPath)) {
      const apiKey = fs.readFileSync(apiKeyPath, 'utf8').trim();
      if (apiKey) {
        return {
          apiUrl: DEFAULT_API_URL,
          apiKey,
          authMethod: 'unknown',
        };
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function saveAuth({ apiUrl, apiKey, authMethod = 'unknown' }) {
  const { authJsonPath, apiKeyPath } = authPaths();
  ensureDir(path.dirname(authJsonPath));
  ensureDir(path.dirname(apiKeyPath));

  const payload = {
    apiUrl,
    apiKey,
    authMethod,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(authJsonPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.writeFileSync(apiKeyPath, apiKey, { mode: 0o600 });
}

function saveSelfHostConfig({ apiUrl, agentId, serverId, token }) {
  const cfgPath = selfHostConfigPath();
  ensureDir(path.dirname(cfgPath));
  const payload = {
    agentId,
    serverId,
    token,
    serverUrl: apiUrl,
  };
  fs.writeFileSync(cfgPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

function normalizeApiUrl(apiUrl) {
  return String(apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value.startsWith('--')) {
      const key = value.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(value);
    }
  }
  return args;
}

function parseResponseData(json) {
  if (json && typeof json === 'object' && 'data' in json) return json.data;
  return json;
}

async function apiCall({ apiUrl, method, endpoint, apiKey, body, query }) {
  const url = new URL(`${normalizeApiUrl(apiUrl)}${endpoint}`);
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v == null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const message = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.payload = json;
    throw error;
  }

  return parseResponseData(json);
}

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function normalizeImageName(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/^docker\.io\//i, '')
    .replace(/^index\.docker\.io\//i, '');
  if (!cleaned) return '';
  return cleaned.includes('/') ? cleaned : `library/${cleaned}`;
}

function normalizeRepoName(name) {
  return normalizeImageName(name).replace(/^library\//, '');
}

function credibilityScore(image) {
  const official = image?.official ? 1 : 0;
  const trusted = image?.is_trusted ? 1 : 0;
  const automated = image?.automated ? 1 : 0;
  const stars = Number(image?.star_count || 0);
  const pulls = Number(image?.pull_count || 0);

  // Credibility dominates, then stars, then pulls.
  // Weights are intentionally large to keep ordering deterministic.
  return (
    official * 1_000_000_000 +
    trusted * 100_000_000 +
    automated * 10_000_000 +
    stars * 10_000 +
    Math.floor(Math.log10(Math.max(1, pulls))) * 100
  );
}

function selectDockerImage(queryName, images) {
  const target = normalizeImageName(queryName).toLowerCase();
  const targetRepo = normalizeRepoName(queryName).toLowerCase();
  const rows = Array.isArray(images) ? images : [];
  if (rows.length === 0) return null;

  const exactMatches = rows.filter(
    (img) => normalizeImageName(img?.name).toLowerCase() === target
  );
  const shortExactMatches = rows.filter(
    (img) => normalizeRepoName(img?.name).toLowerCase() === targetRepo
  );
  const relevantMatches = rows.filter((img) =>
    normalizeRepoName(img?.name).toLowerCase().includes(targetRepo)
  );

  const bucket =
    exactMatches.length > 0
      ? exactMatches
      : shortExactMatches.length > 0
        ? shortExactMatches
        : relevantMatches.length > 0
          ? relevantMatches
          : rows;

  const ranked = bucket
    .slice()
    .sort((a, b) => credibilityScore(b) - credibilityScore(a));

  return normalizeImageName(ranked[0]?.name || '');
}

function toAppNameFromImage(image) {
  const normalized = normalizeImageName(image);
  const repo = normalized.split('/').pop() || normalized;
  return repo
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'app';
}

async function resolveServerId(apiUrl, apiKey) {
  const serversData = await apiCall({
    apiUrl,
    method: 'GET',
    endpoint: '/api/servers',
    apiKey,
  });
  const servers = Array.isArray(serversData) ? serversData : [];

  const connectedHome = servers.find((s) =>
    (s?.cloudProvider === 'HOME' || s?.connectionType === 'AGENT') && s?.status === 'CONNECTED'
  );
  if (connectedHome?.id) return String(connectedHome.id);

  const anyConnected = servers.find((s) => s?.status === 'CONNECTED');
  if (anyConnected?.id) return String(anyConnected.id);

  const anyHome = servers.find((s) => s?.cloudProvider === 'HOME' || s?.connectionType === 'AGENT');
  if (anyHome?.id) return String(anyHome.id);

  return '';
}

async function cmdAuthStatus() {
  const auth = loadAuth();
  if (!auth?.apiKey) {
    printJson({
      status: 'auth_required',
      auth_method: 'unknown',
      is_authenticated: false,
    });
    return;
  }

  try {
    await apiCall({
      apiUrl: auth.apiUrl,
      method: 'GET',
      endpoint: '/api/auth/me',
      apiKey: auth.apiKey,
    });
    printJson({
      status: 'auth_valid',
      auth_method: auth.authMethod || 'unknown',
      is_authenticated: true,
    });
  } catch (error) {
    const statusCode = Number(error?.status || 0);
    if (statusCode === 401 || statusCode === 403) {
      printJson({
        status: 'auth_required',
        auth_method: auth.authMethod || 'unknown',
        is_authenticated: false,
      });
      return;
    }
    printJson({
      status: 'auth_failed',
      auth_method: auth.authMethod || 'unknown',
      is_authenticated: false,
      error: error.message,
    });
  }
}

async function cmdAuthInit(args) {
  const provider = String(args.provider || '').trim().toLowerCase();
  if (provider !== 'google' && provider !== 'github') {
    printJson({ status: 'auth_failed', error: 'provider must be google or github' });
    process.exitCode = 1;
    return;
  }

  const data = await apiCall({
    apiUrl: args['api-url'] || DEFAULT_API_URL,
    method: 'POST',
    endpoint: '/api/auth/cli/device/init',
    body: {
      provider,
      returnUrl: true,
    },
  });

  printJson({
    status: 'auth_required',
    provider,
    auth_url: data?.authUrl || '',
  });
}

async function cmdAuthExchange(args) {
  const code = String(args.code || '').trim().toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(code)) {
    printJson({ status: 'auth_failed', error: 'code must be 10 hex characters' });
    process.exitCode = 1;
    return;
  }

  const apiUrl = normalizeApiUrl(args['api-url'] || DEFAULT_API_URL);
  const data = await apiCall({
    apiUrl,
    method: 'POST',
    endpoint: '/api/auth/cli/device/exchange',
    body: { code },
  });

  const apiKey = String(data?.apiKey || '').trim();
  if (!apiKey) {
    printJson({ status: 'auth_failed', error: 'apiKey missing from exchange response' });
    process.exitCode = 1;
    return;
  }

  const authMethod = String(args.provider || 'unknown').trim().toLowerCase();
  saveAuth({
    apiUrl,
    apiKey,
    authMethod: authMethod === 'google' || authMethod === 'github' ? authMethod : 'unknown',
  });

  printJson({
    status: 'auth_valid',
    auth_method: authMethod === 'google' || authMethod === 'github' ? authMethod : 'unknown',
    is_authenticated: true,
  });
}

async function cmdServerConnect(args) {
  const auth = loadAuth();
  if (!auth?.apiKey) {
    printJson({ status: 'auth_required', is_authenticated: false });
    process.exitCode = 1;
    return;
  }

  const apiUrl = normalizeApiUrl(auth.apiUrl || args['api-url'] || DEFAULT_API_URL);
  try {
    const data = await apiCall({
      apiUrl,
      method: 'POST',
      endpoint: '/api/agents/provision',
      apiKey: auth.apiKey,
      body: {
        name: String(args.name || `${os.hostname()} (Home)`),
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
      },
    });

    const token = String(data?.token || '').trim();
    const serverId = String(data?.serverId || '').trim();
    const agentId = String(data?.agentId || '').trim();
    if (token && serverId) {
      saveSelfHostConfig({ apiUrl, agentId: agentId || serverId, serverId, token });
    }

    printJson({
      status: 'server_connected',
      server_connected: true,
      server_id: serverId || null,
      agent_id: agentId || null,
    });
  } catch (error) {
    if (Number(error?.status || 0) === 409) {
      printJson({
        status: 'server_connected',
        server_connected: true,
      });
      return;
    }
    printJson({
      status: 'server_reconnect_failed',
      server_connected: false,
      error: error.message,
    });
    process.exitCode = 1;
  }
}

async function cmdImageResolve(args) {
  const name = String(args.name || '').trim();
  if (!name) {
    printJson({ status: 'app_deploy_failed', error: 'name is required' });
    process.exitCode = 1;
    return;
  }

  const apiUrl = normalizeApiUrl(args['api-url'] || loadAuth()?.apiUrl || DEFAULT_API_URL);
  const data = await apiCall({
    apiUrl,
    method: 'GET',
    endpoint: '/api/docker-hub/search',
    query: { q: name, limit: 25 },
  });

  const resolved = selectDockerImage(name, data?.images || []);
  if (!resolved) {
    printJson({ status: 'app_deploy_failed', error: 'image not found' });
    process.exitCode = 1;
    return;
  }

  printJson({
    status: 'image_resolved',
    image: resolved,
  });
}

async function cmdAppDeploy(args) {
  const auth = loadAuth();
  if (!auth?.apiKey) {
    printJson({ status: 'auth_required', is_authenticated: false });
    process.exitCode = 1;
    return;
  }

  const inputName = String(args.name || args.image || '').trim();
  if (!inputName) {
    printJson({ status: 'app_deploy_failed', error: 'name (image query) is required' });
    process.exitCode = 1;
    return;
  }

  const apiUrl = normalizeApiUrl(auth.apiUrl || DEFAULT_API_URL);

  const search = await apiCall({
    apiUrl,
    method: 'GET',
    endpoint: '/api/docker-hub/search',
    query: { q: inputName, limit: 25 },
  });

  const resolvedImage = selectDockerImage(inputName, search?.images || []);
  if (!resolvedImage) {
    printJson({ status: 'app_deploy_failed', error: 'unable to resolve image from Docker Hub' });
    process.exitCode = 1;
    return;
  }

  const serverId = String(args['server-id'] || '').trim() || (await resolveServerId(apiUrl, auth.apiKey));
  if (!serverId) {
    printJson({ status: 'app_deploy_failed', error: 'no server available' });
    process.exitCode = 1;
    return;
  }

  const appName = String(args['app-name'] || '').trim() || toAppNameFromImage(resolvedImage);

  const created = await apiCall({
    apiUrl,
    method: 'POST',
    endpoint: '/api/apps',
    apiKey: auth.apiKey,
    body: {
      name: appName,
      serverId,
      dockerImage: resolvedImage,
    },
  });

  const appId = String(created?.id || '').trim();
  if (!appId) {
    printJson({ status: 'app_deploy_failed', error: 'app create did not return id' });
    process.exitCode = 1;
    return;
  }

  const deployData = await apiCall({
    apiUrl,
    method: 'POST',
    endpoint: `/api/apps/${encodeURIComponent(appId)}/deploy`,
    apiKey: auth.apiKey,
    body: { dockerImage: resolvedImage },
  });

  printJson({
    status: 'app_deploy_started',
    app_id: appId,
    deployment_id: deployData?.id || null,
    image: resolvedImage,
    server_id: serverId,
  });
}

async function cmdAppDelete(args) {
  const auth = loadAuth();
  if (!auth?.apiKey) {
    printJson({ status: 'auth_required', is_authenticated: false });
    process.exitCode = 1;
    return;
  }

  const appId = String(args['app-id'] || '').trim();
  if (!appId) {
    printJson({ status: 'app_deploy_failed', error: 'app-id is required' });
    process.exitCode = 1;
    return;
  }

  await apiCall({
    apiUrl: auth.apiUrl,
    method: 'DELETE',
    endpoint: `/api/apps/${encodeURIComponent(appId)}`,
    apiKey: auth.apiKey,
  });

  printJson({ status: 'app_deleted', app_id: appId });
}

async function cmdServerDelete(args) {
  const auth = loadAuth();
  if (!auth?.apiKey) {
    printJson({ status: 'auth_required', is_authenticated: false });
    process.exitCode = 1;
    return;
  }

  const serverId = String(args['server-id'] || '').trim();
  if (!serverId) {
    printJson({ status: 'server_reconnect_failed', error: 'server-id is required' });
    process.exitCode = 1;
    return;
  }

  await apiCall({
    apiUrl: auth.apiUrl,
    method: 'DELETE',
    endpoint: `/api/servers/${encodeURIComponent(serverId)}`,
    apiKey: auth.apiKey,
  });

  printJson({ status: 'server_deleted', server_id: serverId });
}

function printHelp() {
  printJson({
    commands: [
      'auth-status',
      'auth-init --provider google|github [--api-url URL]',
      'auth-exchange --code CODE [--provider google|github] [--api-url URL]',
      'server-connect [--name NAME]',
      'server-reconnect [--name NAME]',
      'image-resolve --name IMAGE_QUERY [--api-url URL]',
      'app-deploy --name IMAGE_QUERY [--server-id ID] [--app-name NAME]',
      'app-delete --app-id ID',
      'server-delete --server-id ID',
    ],
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = String(args._[0] || '').trim();

  try {
    switch (command) {
      case 'auth-status':
        await cmdAuthStatus();
        break;
      case 'auth-init':
        await cmdAuthInit(args);
        break;
      case 'auth-exchange':
        await cmdAuthExchange(args);
        break;
      case 'server-connect':
      case 'server-reconnect':
        await cmdServerConnect(args);
        break;
      case 'image-resolve':
        await cmdImageResolve(args);
        break;
      case 'app-deploy':
        await cmdAppDeploy(args);
        break;
      case 'app-delete':
        await cmdAppDelete(args);
        break;
      case 'server-delete':
        await cmdServerDelete(args);
        break;
      case 'help':
      case '--help':
      case '-h':
      default:
        printHelp();
        if (command && command !== 'help' && command !== '--help' && command !== '-h') {
          process.exitCode = 1;
        }
    }
  } catch (error) {
    printJson({
      status: 'error',
      error: error?.message || 'Unhandled error',
    });
    process.exitCode = 1;
  }
}

main();
