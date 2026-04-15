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

async function connectSelfHost(apiUrl, apiKey, name) {
  try {
    const data = await apiCall({
      apiUrl,
      method: 'POST',
      endpoint: '/api/agents/provision',
      apiKey,
      body: {
        ...(name ? { name: String(name).trim() } : {}),
      },
    });
    const token = String(data?.token || '').trim();
    const serverId = String(data?.serverId || '').trim();
    const agentId = String(data?.agentId || '').trim();
    if (token && serverId) {
      saveSelfHostConfig({ apiUrl, agentId: agentId || serverId, serverId, token });
    }
    return {
      status: 'server_connected',
      server_connected: true,
      server_id: serverId || null,
      agent_id: agentId || null,
    };
  } catch (error) {
    return {
      status: 'server_reconnect_failed',
      server_connected: false,
      error: error?.message || 'Failed to connect self-host agent',
    };
  }
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
    (img) => normalizeImageName(String(img?.name || '')).toLowerCase() === target
  );
  const shortExactMatches = rows.filter(
    (img) => normalizeRepoName(String(img?.name || '')).toLowerCase() === targetRepo
  );
  const relevantMatches = rows.filter((img) =>
    normalizeRepoName(String(img?.name || '')).toLowerCase().includes(targetRepo)
  );

  const bucket =
    exactMatches.length > 0
      ? exactMatches
      : shortExactMatches.length > 0
        ? shortExactMatches
        : relevantMatches.length > 0
          ? relevantMatches
          : rows;

  const ranked = bucket.slice().sort((a, b) => credibilityScore(b) - credibilityScore(a));
  const selected = normalizeImageName(String(ranked[0]?.name || ''));
  return selected || null;
}

function appNameFromImage(image) {
  const normalized = normalizeImageName(image);
  const repo = normalized.split('/').pop() || normalized;
  return (
    repo
      .replace(/[^a-zA-Z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'app'
  );
}

function selectServerForSkill(servers) {
  const rows = Array.isArray(servers) ? servers : [];
  if (rows.length === 0) return null;
  const connectedHome = rows.find(
    (s) => (s?.cloudProvider === 'HOME' || s?.connectionType === 'AGENT') && s?.status === 'CONNECTED'
  );
  if (connectedHome) return connectedHome;
  const connectedAny = rows.find((s) => s?.status === 'CONNECTED');
  if (connectedAny) return connectedAny;
  return rows[0];
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
  const provider = String(args.provider || args._[1] || '').trim().toLowerCase();
  if (provider !== 'google' && provider !== 'github') {
    printJson({ status: 'auth_failed', error: 'usage: auth-init google|github' });
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
    auth_method: provider,
    is_authenticated: false,
    auth_url: data?.authUrl || data?.auth_url || '',
  });
}

async function cmdAuthExchange(args) {
  const code = String(args.code || args._[1] || '').trim().toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(code)) {
    printJson({ status: 'auth_failed', error: 'usage: auth-exchange <10-char-code> [google|github]' });
    process.exitCode = 1;
    return;
  }

  const apiUrl = normalizeApiUrl(args['api-url'] || DEFAULT_API_URL);
  const provider = String(args.provider || args._[2] || 'unknown').trim().toLowerCase();
  const data = await apiCall({
    apiUrl,
    method: 'POST',
    endpoint: '/api/auth/cli/device/exchange',
    body: {
      code,
    },
  });

  const apiKey = String(data?.apiKey || '').trim();
  if (!apiKey) {
    printJson({ status: 'auth_failed', error: 'apiKey missing from exchange response' });
    process.exitCode = 1;
    return;
  }

  saveAuth({
    apiUrl,
    apiKey,
    authMethod: provider === 'google' || provider === 'github' ? provider : 'unknown',
  });

  const connectResult = await connectSelfHost(apiUrl, apiKey, args.name || args._[3]);
  printJson({
    status: 'auth_valid',
    auth_method: provider === 'google' || provider === 'github' ? provider : 'unknown',
    is_authenticated: true,
    server_status: connectResult.status,
    server_connected: connectResult.server_connected,
    server_id: connectResult.server_id || null,
    agent_id: connectResult.agent_id || null,
    ...(connectResult.error ? { server_error: connectResult.error } : {}),
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
  const result = await connectSelfHost(apiUrl, auth.apiKey, args.name || args._[1]);
  printJson({
    status: result.status,
    server_connected: result.server_connected,
    server_id: result.server_id || null,
    agent_id: result.agent_id || null,
    ...(result.error ? { error: result.error } : {}),
  });
}

async function cmdAppDeploy(args) {
  const auth = loadAuth();
  if (!auth?.apiKey) {
    printJson({ status: 'auth_required', is_authenticated: false });
    process.exitCode = 1;
    return;
  }

  const inputName = String(args.name || args.image || args._[1] || '').trim();
  if (!inputName) {
    printJson({ status: 'app_deploy_failed', error: 'name (image query) is required' });
    process.exitCode = 1;
    return;
  }

  const apiUrl = normalizeApiUrl(auth.apiUrl || DEFAULT_API_URL);
  const searchData = await apiCall({
    apiUrl,
    method: 'GET',
    endpoint: '/api/docker-hub/search',
    query: { q: inputName, limit: 25 },
  });
  const resolvedImage = selectDockerImage(inputName, searchData?.images || []);
  if (!resolvedImage) {
    printJson({ status: 'app_deploy_failed', error: 'unable to resolve image from Docker Hub' });
    process.exitCode = 1;
    return;
  }

  const servers = await apiCall({
    apiUrl,
    method: 'GET',
    endpoint: '/api/servers',
    apiKey: auth.apiKey,
  });
  const selectedServer = selectServerForSkill(servers);
  if (!selectedServer?.id) {
    printJson({ status: 'app_deploy_failed', error: 'no server available' });
    process.exitCode = 1;
    return;
  }

  const created = await apiCall({
    apiUrl,
    method: 'POST',
    endpoint: '/api/apps',
    apiKey: auth.apiKey,
    body: {
      name: appNameFromImage(resolvedImage),
      serverId: selectedServer.id,
      dockerImage: resolvedImage,
    },
  });

  const appId = String(created?.id || created?.app?.id || '').trim();
  let deploymentId = String(created?.deployment?.id || '').trim();
  if (appId && !deploymentId) {
    const deployData = await apiCall({
      apiUrl,
      method: 'POST',
      endpoint: `/api/apps/${encodeURIComponent(appId)}/deploy`,
      apiKey: auth.apiKey,
      body: {},
    });
    deploymentId = String(deployData?.id || '').trim();
  }

  printJson({
    status: 'app_deploy_started',
    app_id: appId || null,
    deployment_id: deploymentId || null,
    image: resolvedImage,
    server_id: String(selectedServer.id || ''),
  });
}

async function cmdAppDelete(args) {
  const auth = loadAuth();
  if (!auth?.apiKey) {
    printJson({ status: 'auth_required', is_authenticated: false });
    process.exitCode = 1;
    return;
  }

  const appId = String(args['app-id'] || args._[1] || '').trim();
  if (!appId) {
    printJson({ status: 'app_deploy_failed', error: 'usage: delete-app <app-id>' });
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

async function cmdListApps() {
  const auth = loadAuth();
  if (!auth?.apiKey) {
    printJson({ status: 'auth_required', is_authenticated: false });
    process.exitCode = 1;
    return;
  }

  const apps = await apiCall({
    apiUrl: auth.apiUrl,
    method: 'GET',
    endpoint: '/api/apps',
    apiKey: auth.apiKey,
  });

  const rows = Array.isArray(apps)
    ? apps.map((app) => ({
        id: String(app?.id || ''),
        name: String(app?.name || ''),
        status: String(app?.status || ''),
        server_id: String(app?.serverId || ''),
        server_name: String(app?.server?.name || ''),
      }))
    : [];

  printJson({
    status: 'apps_list',
    count: rows.length,
    apps: rows,
  });
}

async function cmdServerDelete(args) {
  const auth = loadAuth();
  if (!auth?.apiKey) {
    printJson({ status: 'auth_required', is_authenticated: false });
    process.exitCode = 1;
    return;
  }

  const serverId = String(args['server-id'] || args._[1] || '').trim();
  if (!serverId) {
    printJson({ status: 'server_reconnect_failed', error: 'usage: delete-server <server-id>' });
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

async function cmdListServers() {
  const auth = loadAuth();
  if (!auth?.apiKey) {
    printJson({ status: 'auth_required', is_authenticated: false });
    process.exitCode = 1;
    return;
  }

  const servers = await apiCall({
    apiUrl: auth.apiUrl,
    method: 'GET',
    endpoint: '/api/servers',
    apiKey: auth.apiKey,
  });

  const rows = Array.isArray(servers)
    ? servers.map((server) => ({
        id: String(server?.id || ''),
        name: String(server?.name || ''),
        status: String(server?.status || ''),
        cloud_provider: String(server?.cloudProvider || ''),
        connection_type: String(server?.connectionType || ''),
      }))
    : [];

  printJson({
    status: 'servers_list',
    count: rows.length,
    servers: rows,
  });
}

function printHelp() {
  printJson({
    commands: [
      'auth-status',
      'auth-init google|github',
      'auth-exchange CODE [google|github]',
      'connect [name]',
      'deploy IMAGE_NAME',
      'list-apps',
      'list-servers',
      'delete-app APP_ID',
      'delete-server SERVER_ID',
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
      case 'connect':
        await cmdServerConnect(args);
        break;
      case 'deploy':
        await cmdAppDeploy(args);
        break;
      case 'list-apps':
        await cmdListApps();
        break;
      case 'list-servers':
        await cmdListServers();
        break;
      case 'delete-app':
        await cmdAppDelete(args);
        break;
      case 'delete-server':
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
