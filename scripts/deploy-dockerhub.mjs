#!/usr/bin/env node

import {
  apiRequest,
  buildFallbackUrl,
  getApp,
  getDeployments,
  getServers,
  inferAppNameFromImage,
  normalizeApiUrl,
  parseArgs,
  pickBestDockerHubImage,
  preferHomeAgentServer,
  requireArg,
  searchDockerHub,
  toEnvObject,
} from '../lib/clikdeploy-client.mjs';

const POLL_MS = 2000;
const TIMEOUT_MS = 10 * 60 * 1000;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForDeployment(apiUrl, apiKey, appId, deploymentId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < TIMEOUT_MS) {
    const deployments = await getDeployments(apiUrl, apiKey, appId);
    const current = deployments.find((item) => String(item.id) === String(deploymentId));

    if (!current) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    const status = String(current.status || '').toUpperCase();
    if (status === 'SUCCESS') {
      return current;
    }
    if (status === 'FAILED') {
      const reason = current.error || 'Deployment failed';
      throw new Error(String(reason));
    }

    await sleep(POLL_MS);
  }

  throw new Error('Deployment timed out');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apiUrl = normalizeApiUrl(requireArg(args, 'api-url'));
  const apiKey = requireArg(args, 'api-key');
  let image = args.image ? String(args.image) : '';
  const query = args.query ? String(args.query) : '';
  const autoPick = args['auto-pick'] ? true : false;
  const explicitServer = args.server ? String(args.server) : undefined;
  if (!image && query) {
    const results = await searchDockerHub(apiUrl, query, { page: 1, limit: 25 });
    if (!results.length) throw new Error(`No Docker Hub results found for query: ${query}`);
    const picked = autoPick ? pickBestDockerHubImage(results) : results[0];
    if (!picked?.name) throw new Error('Failed to pick Docker Hub image from search results');
    image = String(picked.name);
  }
  if (!image) {
    throw new Error('Missing image. Use --image <repo[:tag]> or --query <term> [--auto-pick].');
  }

  const appName = args.name ? String(args.name) : inferAppNameFromImage(image);
  const port = parsePort(args.port);
  const environmentVariables = parseEnvArgs(args);
  const wait = args['no-wait'] ? false : true;
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
  if (wait && deployment?.id) {
    deploymentStatus = await waitForDeployment(apiUrl, apiKey, app.id, deployment.id);
  }

  const latestApp = await getApp(apiUrl, apiKey, app.id);
  const url = buildFallbackUrl(server, latestApp || app);

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
    readyMessage: url
      ? `Deployment complete. App is reachable at ${url}`
      : 'Deployment complete, but no URL could be resolved yet.',
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
