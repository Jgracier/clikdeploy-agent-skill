#!/usr/bin/env node

import {
  apiRequest,
  buildDomainUrl,
  getApp,
  getServers,
  inferAppNameFromImage,
  normalizeApiUrl,
  parseArgs,
  pickBestDockerHubImage,
  preferHomeAgentServer,
  searchDockerHub,
  toEnvObject,
} from '../lib/clikdeploy-client.mjs';
import { loadUserApiKey } from '../lib/local-auth-store.mjs';

const TIMEOUT_MS = 10 * 60 * 1000;
const DOMAIN_WAIT_TIMEOUT_MS = 2 * 60 * 1000;
const DOMAIN_WAIT_INTERVAL_MS = 2000;
const DEPLOYMENT_WAIT_SLICE_MS = 30 * 1000;

async function postCallback(callbackUrl, callbackToken, payload) {
  if (!callbackUrl) return;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (callbackToken) headers.Authorization = `Bearer ${callbackToken}`;
  try {
    await fetch(callbackUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    // callback failures are non-fatal for deploy execution
  }
}

function parseEnvArgs(args) {
  const envPairs = [];
  const inline = args.env;
  if (typeof inline === 'string' && inline.trim()) {
    for (const piece of inline.split(',')) {
      const trimmed = piece.trim();
      if (trimmed) envPairs.push(trimmed);
    }
  }
  return toEnvObject(envPairs);
}

function parsePort(raw) {
  if (raw === undefined || raw === null || raw === true) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid --port value: ${raw}`);
  }
  return value;
}

function extractAppAndDeployment(payload) {
  const root = payload?.data && typeof payload.data === 'object' ? payload.data : payload;

  const app =
    (root?.app && typeof root.app === 'object' ? root.app : null) ||
    (root && typeof root === 'object' && root.id ? root : null);

  const deployment =
    (root?.deployment && typeof root.deployment === 'object' ? root.deployment : null) ||
    (app?.deployments && Array.isArray(app.deployments) ? app.deployments[0] : null);

  return { app, deployment };
}

async function waitForDeployment(apiUrl, apiKey, deploymentId) {
  const url =
    `${normalizeApiUrl(apiUrl)}/api/deployments/${encodeURIComponent(String(deploymentId))}/wait` +
    `?wait=1&timeoutMs=${encodeURIComponent(String(DEPLOYMENT_WAIT_SLICE_MS))}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { success: false, raw: text };
  }
  if (!response.ok) {
    const msg = payload?.error || `Deployment wait failed (${response.status})`;
    throw new Error(String(msg));
  }

  const deployment = payload?.data?.deployment || null;
  if (!deployment || !deployment.id) {
    throw new Error('Deployment wait response missing deployment payload');
  }

  const status = String(deployment.status || '').toUpperCase();
  if (status === 'SUCCESS') return deployment;
  if (status === 'FAILED') throw new Error(String(deployment.error || 'Deployment failed'));
  if (status === 'CANCELLED') throw new Error('Deployment cancelled');
  return deployment;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAppDomainUrl(apiUrl, apiKey, appId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DOMAIN_WAIT_TIMEOUT_MS) {
    const app = await getApp(apiUrl, apiKey, appId);
    const url = buildDomainUrl(app);
    if (url) return { app, url };
    await sleep(DOMAIN_WAIT_INTERVAL_MS);
  }
  throw new Error('Deployment completed but app domain URL is not ready yet.');
}

function isAppRunning(app) {
  const status = String(app?.status || '').toUpperCase();
  return status === 'RUNNING';
}

async function waitForDeploymentOrAppReady(apiUrl, apiKey, deploymentId, appId) {
  const startedAt = Date.now();
  let lastDeployment = null;

  while (Date.now() - startedAt < TIMEOUT_MS) {
    const deployment = await waitForDeployment(apiUrl, apiKey, deploymentId);
    lastDeployment = deployment;
    const status = String(deployment?.status || '').toUpperCase();
    if (status === 'SUCCESS') {
      return { deployment, app: null, appReady: false };
    }
    if (status === 'FAILED') throw new Error(String(deployment.error || 'Deployment failed'));
    if (status === 'CANCELLED') throw new Error('Deployment cancelled');

    const app = await getApp(apiUrl, apiKey, appId);
    const url = buildDomainUrl(app);
    if (isAppRunning(app) && url) {
      return { deployment, app, appReady: true };
    }
  }

  if (lastDeployment) return { deployment: lastDeployment, app: null, appReady: false };
  throw new Error('Deployment timed out');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apiUrl = normalizeApiUrl(String(args['api-url'] || 'https://clikdeploy.com'));
  const apiKey = args['api-key'] ? String(args['api-key']) : loadUserApiKey();
  if (!apiKey) {
    throw new Error('Missing user API key. Run auth flow first or pass --api-key.');
  }
  let image = args.image ? String(args.image) : '';
  const query = args.query ? String(args.query) : '';
  const autoPick = Boolean(query);
  const explicitServer = args.server ? String(args.server) : undefined;
  if (!image && query) {
    const results = await searchDockerHub(apiUrl, query, { page: 1, limit: 25 });
    if (!results.length) throw new Error(`No Docker Hub results found for query: ${query}`);
    const picked = pickBestDockerHubImage(results);
    if (!picked?.name) throw new Error('Failed to pick Docker Hub image from search results');
    image = String(picked.name);
  }
  if (!image) {
    throw new Error('Missing image. Use --image <repo[:tag]> or --query <term>.');
  }

  const appName = args.name ? String(args.name) : inferAppNameFromImage(image);
  const port = parsePort(args.port);
  const environmentVariables = parseEnvArgs(args);
  const callbackUrl = args['callback-url'] ? String(args['callback-url']) : '';
  const callbackToken = args['callback-token'] ? String(args['callback-token']) : '';
  const requestId = args['request-id'] ? String(args['request-id']) : '';

  const servers = await getServers(apiUrl, apiKey);
  const server = preferHomeAgentServer(servers, explicitServer);

  const createBody = {
    name: appName,
    dockerImage: image,
    serverId: server.id,
    ...(port ? { port } : {}),
    ...(Object.keys(environmentVariables).length > 0 ? { environmentVariables } : {}),
  };

  const createPayload = await apiRequest(apiUrl, apiKey, '/api/apps', {
    method: 'POST',
    body: createBody,
  });

  const { app, deployment } = extractAppAndDeployment(createPayload);
  if (!app?.id) {
    throw new Error('Create app response did not return an app id');
  }

  let deploymentStatus = deployment || null;
  if (deployment?.id) {
    const waitResult = await waitForDeploymentOrAppReady(apiUrl, apiKey, deployment.id, app.id);
    deploymentStatus = waitResult.deployment;
  }

  const { app: latestApp, url } = await waitForAppDomainUrl(apiUrl, apiKey, app.id);
  const appDisplayName = latestApp?.name || app.name || appName;
  const messageMarkdown = `Your app is now live (flinger point) [${appDisplayName}](${url})`;

  const output = {
    success: true,
    event: 'app_deployed',
    requestId: requestId || null,
    app: {
      id: app.id,
      name: latestApp?.name || app.name || appName,
      image,
      status: latestApp?.status || app.status || null,
      domain: latestApp?.domain || null,
      port: latestApp?.port || app.port || port || 80,
    },
    server: {
      id: server.id,
      name: server.name || null,
      cloudProvider: server.cloudProvider || null,
      connectionType: server.connectionType || null,
      status: server.status || null,
      ipAddress: server.ipAddress || null,
    },
    source: {
      query: query || null,
      autoPick,
    },
    deployment: deploymentStatus
      ? {
          id: deploymentStatus.id || deployment?.id || null,
          status: deploymentStatus.status || null,
          error: deploymentStatus.error || null,
        }
      : null,
    url,
    messageMarkdown,
    readyMessage: url
      ? `Your app is now live (flinger point) ${appDisplayName}: ${url}`
      : 'Deployment complete, but app domain URL is not ready yet.',
  };

  await postCallback(callbackUrl, callbackToken, output);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  const args = parseArgs(process.argv.slice(2));
  const callbackUrl = args['callback-url'] ? String(args['callback-url']) : '';
  const callbackToken = args['callback-token'] ? String(args['callback-token']) : '';
  const requestId = args['request-id'] ? String(args['request-id']) : '';
  void postCallback(callbackUrl, callbackToken, {
    success: false,
    event: 'app_deploy_failed',
    requestId: requestId || null,
    error: message,
  });
  process.exit(1);
});
