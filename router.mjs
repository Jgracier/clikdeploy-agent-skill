#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

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

function notificationInboxPath() {
  return path.join(os.homedir(), '.clikdeploy', 'skill-notifications.jsonl');
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

function clearSelfHostConfig() {
  const cfgPath = selfHostConfigPath();
  try {
    if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
  } catch {
    // ignore local cleanup errors
  }
}

function loadSelfHostConfig() {
  const cfgPath = selfHostConfigPath();
  try {
    if (!fs.existsSync(cfgPath)) return null;
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    return null;
  }
}

function appendNotification(record) {
  const inbox = notificationInboxPath();
  ensureDir(path.dirname(inbox));
  const payload = {
    at: new Date().toISOString(),
    ...record,
  };
  fs.appendFileSync(inbox, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
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

function sendDesktopNotification(title, message) {
  const safeTitle = String(title || 'ClikDeploy').trim() || 'ClikDeploy';
  const safeMessage = String(message || '').trim();
  if (!safeMessage) return;

  if (process.platform === 'linux') {
    tryRun('notify-send', [safeTitle, safeMessage]);
    return;
  }
  if (process.platform === 'darwin') {
    const escapedTitle = safeTitle.replace(/"/g, '\\"');
    const escapedMessage = safeMessage.replace(/"/g, '\\"');
    tryRun('osascript', [
      '-e',
      `display notification "${escapedMessage}" with title "${escapedTitle}"`,
    ]);
  }
}

async function runSelfHostInstaller(apiUrl, serverId, agentToken, agentId) {
  const baseUrl = normalizeApiUrl(apiUrl);
  const installUrl = `${baseUrl}/install.sh`;
  const scriptRes = await fetch(installUrl, { method: 'GET' });
  if (!scriptRes.ok) {
    throw new Error(`Failed to fetch installer script (${scriptRes.status})`);
  }
  const script = await scriptRes.text();
  if (!script || !script.includes('ClikDeploy Agent Installer')) {
    throw new Error('Installer payload invalid');
  }

  const args = ['-s', '--', '--token', agentToken, '--server-id', serverId, '--server', baseUrl];
  if (agentId) args.push('--agent-id', agentId);

  const run = spawnSync('bash', args, {
    input: script,
    stdio: 'inherit',
  });
  if (run.status !== 0) {
    throw new Error(`Installer failed (exit ${String(run.status)})`);
  }
}

async function isServerOnline(apiUrl, apiKey, serverId) {
  try {
    const data = await apiCall({
      apiUrl,
      method: 'GET',
      endpoint: `/api/servers/${encodeURIComponent(serverId)}/agent-status`,
      apiKey,
    });
    return Boolean(data?.online);
  } catch {
    return false;
  }
}

async function waitForServerOnline(apiUrl, apiKey, serverId, timeoutMs = 120000, pollMs = 3000) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const online = await isServerOnline(apiUrl, apiKey, serverId);
    if (online) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

async function connectSelfHost(apiUrl, apiKey, name) {
  try {
    const data = await apiCall({
      apiUrl,
      method: 'POST',
      endpoint: '/api/gate/connect',
      apiKey,
      body: {
        waitForHealthy: false,
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
    const restarted = restartSelfHostRuntime();
    let connected = Boolean(data?.server_connected);
    const serverConnectionState = String(data?.server_connection_state || '').trim().toUpperCase();
    const shouldRecover =
      !restarted ||
      serverConnectionState === 'DISCONNECTED' ||
      serverConnectionState === 'ERROR' ||
      (!connected && !serverConnectionState);
    if (shouldRecover) {
      try {
        await runSelfHostInstaller(apiUrl, serverId, token, agentId);
        connected = await isServerOnline(apiUrl, apiKey, serverId);
      } catch (installerError) {
        return {
          status: 'server_reconnect_failed',
          server_connected: false,
          server_id: serverId || null,
          agent_id: agentId || null,
          error: installerError?.message || 'Failed to install/start self host runtime',
        };
      }
    }
    if (!connected && serverConnectionState === 'CONNECTING' && serverId) {
      connected = await waitForServerOnline(apiUrl, apiKey, serverId);
    }
    return {
      status: connected ? 'server_connected' : 'server_reconnect_failed',
      server_connected: connected,
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

async function waitForDeploymentTerminal(apiUrl, apiKey, deploymentId, timeoutMs = 590000) {
  const data = await apiCall({
    apiUrl,
    method: 'GET',
    endpoint: `/api/deployments/${encodeURIComponent(deploymentId)}/wait`,
    apiKey,
    query: { wait: 1, timeoutMs },
  });
  return data?.deployment || null;
}

async function resolveAppOpenUrl(apiUrl, apiKey, appId) {
  if (!appId) return null;
  try {
    const data = await apiCall({
      apiUrl,
      method: 'GET',
      endpoint: `/api/apps/${encodeURIComponent(appId)}/open-url`,
      apiKey,
      query: { json: 1 },
    });
    const url = String(data?.url || '').trim();
    return url || null;
  } catch {
    return null;
  }
}

function startDetachedDeployNotifier(deploymentId, appName, apiUrl) {
  if (!deploymentId) return;
  const routerPath = path.resolve(process.argv[1] || 'router.mjs');
  const args = [routerPath, 'deploy-notify', deploymentId];
  if (appName) args.push('--app', appName);
  if (apiUrl) args.push('--api-url', apiUrl);
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
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
}

async function cmdAuthExchange(args) {
  const code = String(args.code || args._[1] || '').trim().toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(code)) {
    printJson({ status: 'auth_failed', error: 'usage: auth-exchange <10-char-code>' });
    process.exitCode = 1;
    return;
  }

  const apiUrl = normalizeApiUrl(args['api-url'] || DEFAULT_API_URL);
  const data = await apiCall({
    apiUrl,
    method: 'POST',
    endpoint: '/api/gate/auth/device/exchange',
    body: {
      code,
      autoConnect: true,
      waitForHealthy: false,
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
    authMethod: String(data?.auth_method || 'unknown').trim().toLowerCase() || 'unknown',
  });
  const token = String(data?.agentToken || '').trim();
  const serverId = String(data?.serverId || '').trim();
  const agentId = String(data?.agentId || '').trim();
  const serverConnectionState = String(data?.server_connection_state || '').trim().toUpperCase();
  if (token && serverId) {
    saveSelfHostConfig({ apiUrl, agentId: agentId || serverId, serverId, token });
    const restarted = restartSelfHostRuntime();
    const shouldRecover =
      !restarted ||
      serverConnectionState === 'DISCONNECTED' ||
      serverConnectionState === 'ERROR' ||
      (!Boolean(data?.server_connected) && !serverConnectionState);
    if (shouldRecover) {
      try {
        await runSelfHostInstaller(apiUrl, serverId, token, agentId);
        data.server_connected = await isServerOnline(apiUrl, apiKey, serverId);
        data.server_status = data.server_connected ? 'server_connected' : 'server_reconnect_failed';
      } catch {
        data.server_connected = false;
        data.server_status = 'server_reconnect_failed';
      }
    } else if (!Boolean(data?.server_connected) && serverConnectionState === 'CONNECTING') {
      data.server_connected = await waitForServerOnline(apiUrl, apiKey, serverId);
      data.server_status = data.server_connected ? 'server_connected' : 'server_reconnect_failed';
    }
  }
  printJson({
    status: data?.status || 'auth_valid',
    auth_method: String(data?.auth_method || 'unknown').trim().toLowerCase() || 'unknown',
    is_authenticated: true,
    server_status: String(data?.server_status || ''),
    server_connected: Boolean(data?.server_connected),
    agent_state: Boolean(data?.server_connected) ? 'ready' : 'needs_attention',
    message: Boolean(data?.server_connected)
      ? 'All set. What app should I deploy?'
      : 'Signed in, but Self Host connect failed. Run connect self-host.',
    ...(Boolean(data?.server_connected)
      ? {}
      : {
          server_id: serverId || null,
          agent_id: agentId || null,
        }),
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
    agent_state: result.status === 'server_connected' ? 'ready' : 'needs_attention',
    message: result.status === 'server_connected'
      ? 'All set. What app should I deploy?'
      : 'Self Host connection failed. Try reconnect.',
    ...(result.status === 'server_connected'
      ? {}
      : {
          server_id: result.server_id || null,
          agent_id: result.agent_id || null,
        }),
    ...(result.error ? { error: result.error } : {}),
  });
}

async function cmdServerStatus() {
  const auth = loadAuth();
  if (!auth?.apiKey) {
    printJson({ status: 'auth_required', is_authenticated: false });
    process.exitCode = 1;
    return;
  }

  const apiUrl = normalizeApiUrl(auth.apiUrl || DEFAULT_API_URL);
  const local = loadSelfHostConfig();
  let serverId = String(local?.serverId || '').trim();

  if (!serverId) {
    const servers = await apiCall({
      apiUrl,
      method: 'GET',
      endpoint: '/api/gate/servers',
      apiKey: auth.apiKey,
    });
    const rows = Array.isArray(servers?.servers) ? servers.servers : [];
    const selfHost =
      rows.find((s) => String(s?.connectionType || '').toUpperCase() === 'AGENT') ||
      rows.find((s) => String(s?.cloudProvider || '').toUpperCase() === 'HOME');
    serverId = String(selfHost?.id || '').trim();
  }

  if (!serverId) {
    printJson({
      status: 'server_reconnect_failed',
      server_connected: false,
      agent_state: 'needs_attention',
      message: 'Self Host is not configured locally. Run connect self-host.',
    });
    return;
  }

  const [agentStatus, server] = await Promise.all([
    apiCall({
      apiUrl,
      method: 'GET',
      endpoint: `/api/servers/${encodeURIComponent(serverId)}/agent-status`,
      apiKey: auth.apiKey,
    }),
    apiCall({
      apiUrl,
      method: 'GET',
      endpoint: `/api/servers/${encodeURIComponent(serverId)}`,
      apiKey: auth.apiKey,
    }),
  ]);

  const connected =
    Boolean(agentStatus?.online) && String(server?.status || '').trim().toUpperCase() === 'CONNECTED';

  printJson({
    status: connected ? 'server_connected' : 'server_reconnect_failed',
    server_connected: connected,
    agent_state: connected ? 'ready' : 'needs_attention',
    message: connected ? 'Self Host is connected.' : 'Self Host is not connected. Run connect self-host.',
    ...(connected
      ? {}
      : {
          server_id: serverId,
          server_status: String(server?.status || ''),
          online: Boolean(agentStatus?.online),
        }),
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
  const status = String(deployed?.status || 'app_deploy_started').trim();
  const deploymentId = String(deployed?.deploymentId || '').trim();
  if (status === 'app_deploy_started' && deploymentId) {
    startDetachedDeployNotifier(deploymentId, inputName, auth.apiUrl);
  }

  printJson({
    status,
    agent_state: status === 'app_deploy_started' ? 'ready' : 'needs_attention',
    message:
      status === 'app_deploy_started'
        ? inputName
          ? `Deploy started for ${inputName}. This may take a few minutes. I will notify you when it is completed.`
          : 'Deploy started. This may take a few minutes. I will notify you when it is completed.'
        : 'Deploy request failed.',
    ...(status === 'app_deploy_started'
      ? {}
      : {
          app_id: deployed?.appId || null,
          deployment_id: deployed?.deploymentId || null,
          image: deployed?.image || null,
          server_id: deployed?.serverId || null,
        }),
  });
}

async function cmdDeployNotify(args) {
  const deploymentId = String(args._[1] || '').trim();
  if (!deploymentId) {
    process.exitCode = 1;
    return;
  }
  const appName = String(args.app || '').trim() || 'App';
  const auth = loadAuth();
  if (!auth?.apiKey) {
    appendNotification({
      type: 'deploy',
      deployment_id: deploymentId,
      status: 'FAILED',
      message: `${appName} deployment status could not be checked (not authenticated).`,
    });
    return;
  }

  const apiUrl = normalizeApiUrl(args['api-url'] || auth.apiUrl || DEFAULT_API_URL);
  let finalStatus = 'UNKNOWN';
  let finalMessage = `${appName} deployment status could not be confirmed.`;
  let appUrl = null;

  try {
    const deployment = await waitForDeploymentTerminal(apiUrl, auth.apiKey, deploymentId);
    finalStatus = String(deployment?.status || 'UNKNOWN').trim().toUpperCase();
    const appId = String(deployment?.appId || '').trim();
    if (finalStatus === 'SUCCESS') {
      appUrl = await resolveAppOpenUrl(apiUrl, auth.apiKey, appId);
      finalMessage = appUrl
        ? `${appName} deployed successfully, here is the url to begin using it: ${appUrl}`
        : `${appName} deployed successfully.`;
    } else if (finalStatus === 'FAILED') {
      finalMessage = `${appName} deployment failed. Open ClikDeploy to review logs.`;
    } else if (finalStatus === 'CANCELLED') {
      finalMessage = `${appName} deployment was cancelled.`;
    } else {
      finalMessage = `${appName} deployment status: ${finalStatus.toLowerCase()}.`;
    }
  } catch {
    finalStatus = 'FAILED';
    finalMessage = `${appName} deployment status check failed.`;
  }

  appendNotification({
    type: 'deploy',
    deployment_id: deploymentId,
    status: finalStatus,
    message: finalMessage,
    ...(appUrl ? { url: appUrl } : {}),
  });
  sendDesktopNotification('ClikDeploy', finalMessage);
}

async function cmdNotifications() {
  const inbox = notificationInboxPath();
  if (!fs.existsSync(inbox)) {
    printJson({ status: 'notifications', count: 0, notifications: [] });
    return;
  }
  const raw = fs.readFileSync(inbox, 'utf8');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const notifications = lines
    .slice(-20)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  printJson({
    status: 'notifications',
    count: notifications.length,
    notifications,
  });
}

async function cmdNotificationsClear() {
  const inbox = notificationInboxPath();
  try {
    if (fs.existsSync(inbox)) fs.unlinkSync(inbox);
  } catch {
    // ignore local cleanup errors
  }
  printJson({ status: 'notifications_cleared' });
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

  let servers;
  try {
    servers = await apiCall({
      apiUrl: auth.apiUrl,
      method: 'GET',
      endpoint: '/api/gate/servers',
      apiKey: auth.apiKey,
    });
  } catch {
    const direct = await apiCall({
      apiUrl: auth.apiUrl,
      method: 'GET',
      endpoint: '/api/servers',
      apiKey: auth.apiKey,
      query: { page: 1, pageSize: 100 },
    });
    const rows = Array.isArray(direct) ? direct : Array.isArray(direct?.data) ? direct.data : [];
    servers = {
      status: 'servers_list',
      count: rows.length,
      servers: rows.map((server) => ({
        id: String(server?.id || ''),
        name: String(server?.name || ''),
        status: String(server?.status || ''),
        cloudProvider: String(server?.cloudProvider || ''),
        connectionType: String(server?.connectionType || ''),
        ipAddress: String(server?.ipAddress || ''),
        healthError: String(server?.healthError || ''),
      })),
    };
  }

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
      'server-status',
      'connect [name]',
      'deploy IMAGE_NAME',
      'notifications',
      'notifications-clear',
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
      case 'server-status':
        await cmdServerStatus();
        break;
      case 'deploy':
        await cmdAppDeploy(args);
        break;
      case 'deploy-notify':
        await cmdDeployNotify(args);
        break;
      case 'notifications':
        await cmdNotifications();
        break;
      case 'notifications-clear':
        await cmdNotificationsClear();
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
