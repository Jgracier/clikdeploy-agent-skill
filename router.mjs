#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

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
    pendingProviderPath: path.join(os.homedir(), '.clikdeploy', 'pending-provider'),
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

function savePendingProvider(provider) {
  const { pendingProviderPath } = authPaths();
  ensureDir(path.dirname(pendingProviderPath));
  fs.writeFileSync(pendingProviderPath, String(provider || '').trim().toLowerCase(), { mode: 0o600 });
}

function loadPendingProvider() {
  const { pendingProviderPath } = authPaths();
  try {
    if (!fs.existsSync(pendingProviderPath)) return '';
    const value = fs.readFileSync(pendingProviderPath, 'utf8').trim().toLowerCase();
    if (value === 'google' || value === 'github') return value;
  } catch {
    // ignore
  }
  return '';
}

function clearPendingProvider() {
  const { pendingProviderPath } = authPaths();
  try {
    if (fs.existsSync(pendingProviderPath)) fs.unlinkSync(pendingProviderPath);
  } catch {
    // ignore
  }
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

function clearSelfHostConfig() {
  const cfgPath = selfHostConfigPath();
  try {
    if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
  } catch {
    // ignore local cleanup errors
  }
}

function tryRun(cmd, args) {
  try {
    const result = spawnSync(cmd, args, { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

function restartSelfHostRuntime() {
  if (process.platform === 'linux') {
    const ok = tryRun('systemctl', ['--user', 'restart', 'clikdeploy-self-host.service']);
    if (ok) return true;
    return tryRun('systemctl', ['--user', 'start', 'clikdeploy-self-host.service']);
  }
  if (process.platform === 'darwin') {
    const uid = String(process.getuid ? process.getuid() : '').trim();
    if (!uid) return false;
    return tryRun('launchctl', ['kickstart', '-k', `gui/${uid}/com.clikdeploy.self-host`]);
  }
  return false;
}

function stopSelfHostRuntime() {
  if (process.platform === 'linux') {
    return tryRun('systemctl', ['--user', 'stop', 'clikdeploy-self-host.service']);
  }
  if (process.platform === 'darwin') {
    const uid = String(process.getuid ? process.getuid() : '').trim();
    if (!uid) return false;
    return tryRun('launchctl', ['bootout', `gui/${uid}/com.clikdeploy.self-host`]);
  }
  return false;
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

async function waitForAgentOnlineByCallback(apiUrl, agentToken) {
  const token = String(agentToken || '').trim();
  if (!token) return { confirmed: false, online: false, serverStatus: 'CONNECTING' };
  try {
    const url = `${normalizeApiUrl(apiUrl)}/api/agents/install-report?wait=1`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const json = await res.json().catch(() => ({}));
    const data = json && typeof json === 'object' && 'data' in json ? json.data : json;
    if (!res.ok) return { confirmed: false, online: false, serverStatus: 'CONNECTING' };
    return {
      online: Boolean(data?.online),
      confirmed: Boolean(data?.confirmed),
      serverStatus: String(data?.serverStatus || 'CONNECTING'),
    };
  } catch {
    return { confirmed: false, online: false, serverStatus: 'CONNECTING' };
  }
}

async function connectSelfHost(apiUrl, apiKey, name) {
  try {
    const data = await apiCall({
      apiUrl,
      method: 'POST',
      endpoint: '/api/gate/connect',
      apiKey,
      body: {
        ...(name ? { name: String(name).trim() } : {}),
      },
    });
    const token = String(data?.agentToken || '').trim();
    const serverId = String(data?.serverId || '').trim();
    const agentId = String(data?.agentId || '').trim();
    if (!token || !serverId) {
      return {
        status: 'server_reconnect_failed',
        server_connected: false,
        error: 'Provision did not return agent credentials',
      };
    }
    saveSelfHostConfig({ apiUrl, agentId: agentId || serverId, serverId, token });
    restartSelfHostRuntime();
    const waited = await waitForAgentOnlineByCallback(apiUrl, token);
    if (!waited.confirmed || !waited.online) {
      return {
        status: 'server_reconnect_failed',
        server_connected: false,
        server_id: serverId || null,
        agent_id: agentId || null,
        error: 'Timed out waiting for self host callback confirmation',
      };
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
      error: error?.message || 'Failed to connect self host agent',
    };
  }
}

async function cmdAuthStatus() {
  const auth = loadAuth();
  const data = await apiCall({
    apiUrl: auth?.apiUrl || DEFAULT_API_URL,
    method: 'GET',
    endpoint: '/api/gate/auth/status',
    apiKey: auth?.apiKey,
  });
  printJson({
    status: data?.status || 'auth_required',
    auth_method: data?.auth_method || auth?.authMethod || 'unknown',
    is_authenticated: Boolean(data?.is_authenticated),
  });
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
    endpoint: '/api/gate/auth/device/init',
    body: {
      provider,
    },
  });

  printJson({
    status: 'auth_required',
    auth_method: provider,
    is_authenticated: false,
    auth_url: data?.authUrl || data?.auth_url || '',
  });
  savePendingProvider(provider);
}

async function cmdAuthExchange(args) {
  const code = String(args.code || args._[1] || '').trim().toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(code)) {
    printJson({ status: 'auth_failed', error: 'usage: auth-exchange <10-char-code>' });
    process.exitCode = 1;
    return;
  }

  const apiUrl = normalizeApiUrl(args['api-url'] || DEFAULT_API_URL);
  const providerArg = String(args.provider || args._[2] || '').trim().toLowerCase();
  const inferredProvider = loadPendingProvider();
  const provider =
    providerArg === 'google' || providerArg === 'github'
      ? providerArg
      : inferredProvider || 'unknown';
  const data = await apiCall({
    apiUrl,
    method: 'POST',
    endpoint: '/api/gate/auth/device/exchange',
    body: {
      code,
      autoConnect: true,
      ...(args.name || args._[3] ? { name: String(args.name || args._[3]).trim() } : {}),
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
  clearPendingProvider();
  const token = String(data?.agentToken || '').trim();
  const serverId = String(data?.serverId || '').trim();
  const agentId = String(data?.agentId || '').trim();
  if (token && serverId) {
    saveSelfHostConfig({ apiUrl, agentId: agentId || serverId, serverId, token });
    restartSelfHostRuntime();
    const waited = await waitForAgentOnlineByCallback(apiUrl, token);
    data.server_connected = Boolean(waited.confirmed && waited.online);
    data.server_status = waited.confirmed && waited.online ? 'server_connected' : 'server_reconnect_failed';
  }
  printJson({
    status: data?.status || 'auth_valid',
    auth_method: provider === 'google' || provider === 'github' ? provider : 'unknown',
    is_authenticated: true,
    server_status: String(data?.server_status || ''),
    server_connected: Boolean(data?.server_connected),
    server_id: serverId || null,
    agent_id: agentId || null,
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

  const deployed = await apiCall({
    apiUrl: auth.apiUrl,
    method: 'POST',
    endpoint: '/api/gate/deploy',
    apiKey: auth.apiKey,
    body: {
      name: inputName,
    },
  });

  printJson({
    status: deployed?.status || 'app_deploy_started',
    app_id: deployed?.appId || null,
    deployment_id: deployed?.deploymentId || null,
    image: deployed?.image || null,
    server_id: deployed?.serverId || null,
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
    endpoint: `/api/gate/apps/${encodeURIComponent(appId)}`,
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
    endpoint: '/api/gate/apps',
    apiKey: auth.apiKey,
  });

  printJson({
    status: apps?.status || 'apps_list',
    count: Number(apps?.count || 0),
    apps: Array.isArray(apps?.apps) ? apps.apps : [],
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
    endpoint: `/api/gate/servers/${encodeURIComponent(serverId)}`,
    apiKey: auth.apiKey,
  });
  stopSelfHostRuntime();
  clearSelfHostConfig();

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
    endpoint: '/api/gate/servers',
    apiKey: auth.apiKey,
  });

  printJson({
    status: servers?.status || 'servers_list',
    count: Number(servers?.count || 0),
    servers: Array.isArray(servers?.servers) ? servers.servers : [],
  });
}

function printHelp() {
  printJson({
    commands: [
      'auth-status',
      'auth-init google|github',
      'auth-exchange CODE',
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
