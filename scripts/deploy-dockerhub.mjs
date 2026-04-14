#!/usr/bin/env node

import {
  apiRequest,
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

const TERMINAL_DEPLOY_STATUSES = new Set(['SUCCESS', 'FAILED', 'CANCELLED']);

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

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
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

  return { app, deployment, callbackSessionId: root?.callbackSessionId || null };
}

function extractObject(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return payload.data;
  }
  return payload;
}

function createSpinner(enabled = true) {
  if (!enabled) {
    return {
      update: () => {},
      stop: () => {},
    };
  }

  const frames = ['|', '/', '-', '\\'];
  let frame = 0;
  let text = 'Deploying...';
  const timer = setInterval(() => {
    const cursor = frames[frame % frames.length];
    process.stdout.write(`\r${cursor} ${text}`);
    frame += 1;
  }, 100);

  return {
    update(nextText) {
      text = String(nextText || text);
    },
    stop(finalLine = '') {
      clearInterval(timer);
      process.stdout.write('\r');
      process.stdout.write(' '.repeat(Math.max(8, text.length + 4)));
      process.stdout.write('\r');
      if (finalLine) process.stdout.write(`${finalLine}\n`);
    },
  };
}

async function pollDeploymentUntilTerminal({
  apiUrl,
  apiKey,
  deploymentId,
  timeoutMs,
  spinner,
}) {
  if (!deploymentId) {
    throw new Error('Missing deployment id for wait operation');
  }

  spinner.update('Waiting for deployment completion event...');
  const waitPayload = await apiRequest(
    apiUrl,
    apiKey,
    `/api/deployments/${encodeURIComponent(String(deploymentId))}/wait?wait=1&timeoutMs=${encodeURIComponent(String(timeoutMs))}`
  );
  const waitData = extractObject(waitPayload) || {};
  const latest = waitData?.deployment || null;
  const status = String(latest?.status || '').toUpperCase();
  if (status && TERMINAL_DEPLOY_STATUSES.has(status)) {
    return latest;
  }
  throw new Error(`Deployment wait timed out after ${Math.floor(timeoutMs / 1000)}s`);
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
  const explicitServer = args.server ? String(args.server) : undefined;
  if (!image && query) {
    const results = await searchDockerHub(apiUrl, query, { page: 1, limit: 25 });
    if (!results.length) throw new Error(`No Docker Hub results found for query: ${query}`);
    const picked = pickBestDockerHubImage(results);
    if (!picked?.name) throw new Error('Failed to pick Docker Hub image from search results');
    image = String(picked.name);
  }
  if (!image) {
    throw new Error('Missing target. Use --query <app_query> or --image <repo[:tag]>.');
  }

  const appName = args.name ? String(args.name) : inferAppNameFromImage(image);
  const port = parsePort(args.port);
  const environmentVariables = parseEnvArgs(args);
  const callbackUrl = firstNonEmpty(
    args['callback-url'] ? String(args['callback-url']) : '',
    process.env.HERMES_CALLBACK_URL,
    process.env.CLIKDEPLOY_CALLBACK_URL
  );
  const callbackToken = firstNonEmpty(
    args['callback-token'] ? String(args['callback-token']) : '',
    process.env.HERMES_CALLBACK_TOKEN,
    process.env.CLIKDEPLOY_CALLBACK_TOKEN
  );
  const requestId = firstNonEmpty(
    args['request-id'] ? String(args['request-id']) : '',
    process.env.HERMES_REQUEST_ID,
    process.env.CLIKDEPLOY_REQUEST_ID
  );
  const waitForTerminal = args.wait
    ? true
    : args['no-wait']
      ? false
      : callbackUrl
        ? false
        : true;
  const timeoutMs = args['wait-timeout-ms'] ? Number(args['wait-timeout-ms']) : 15 * 60 * 1000;

  const servers = await getServers(apiUrl, apiKey);
  const server = preferHomeAgentServer(servers, explicitServer);

  const createBody = {
    name: appName,
    dockerImage: image,
    serverId: server.id,
    ...(port ? { port } : {}),
    ...(Object.keys(environmentVariables).length > 0 ? { environmentVariables } : {}),
    ...(callbackUrl ? { callbackUrl } : {}),
    ...(callbackToken ? { callbackToken } : {}),
    ...(requestId ? { requestId } : {}),
  };

  const createPayload = await apiRequest(apiUrl, apiKey, '/api/apps', {
    method: 'POST',
    body: createBody,
  });

  const { app, deployment, callbackSessionId } = extractAppAndDeployment(createPayload);
  if (!app?.id) {
    throw new Error('Create app response did not return an app id');
  }

  let finalDeployment = deployment || null;
  let finalApp = app;

  if (waitForTerminal) {
    const spinner = createSpinner(true);
    try {
      spinner.update(`${app.name || appName}: DEPLOYING`);
      finalDeployment = await pollDeploymentUntilTerminal({
        apiUrl,
        apiKey,
        deploymentId: deployment?.id,
        timeoutMs,
        spinner,
      });

      const refreshedAppPayload = await apiRequest(apiUrl, apiKey, `/api/apps/${encodeURIComponent(app.id)}`);
      finalApp = extractObject(refreshedAppPayload) || app;
      spinner.stop(
        String(finalDeployment?.status || '').toUpperCase() === 'SUCCESS'
          ? `OK ${app.name || appName}: deployment completed`
          : `FAILED ${app.name || appName}: deployment ${String(finalDeployment?.status || 'failed').toLowerCase()}`
      );
    } catch (error) {
      spinner.stop(`FAILED ${app.name || appName}: deployment monitoring failed`);
      throw error;
    }
  }

  const finalStatus = String(finalDeployment?.status || deployment?.status || '').toUpperCase();
  const domain = finalApp?.domain || app?.domain || null;
  const url = domain ? `https://${domain}` : null;
  const isSuccess = finalStatus === 'SUCCESS';
  const output = {
    success: waitForTerminal ? isSuccess : true,
    event: waitForTerminal ? (isSuccess ? 'app_deployed' : 'app_deploy_failed') : 'app_deploy_started',
    requestId: requestId || null,
    callbackSessionId: callbackSessionId || null,
    app: {
      id: finalApp?.id || app.id,
      name: finalApp?.name || app.name || appName,
      image,
      status: finalApp?.status || app.status || null,
      domain,
      port: finalApp?.port || app.port || port || 80,
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
      image,
      query: query || null,
      autoPick: Boolean(query && !args.image),
    },
    deployment: finalDeployment
      ? {
          id: finalDeployment.id || null,
          status: finalDeployment.status || null,
          error: finalDeployment.error || null,
        }
      : null,
    ...(url ? { url } : {}),
    messageMarkdown: waitForTerminal
      ? isSuccess
        ? `Your app is now live: ${url || '(URL pending)'}`
        : `Deployment failed${finalDeployment?.error ? `: ${finalDeployment.error}` : '.'}`
      : callbackSessionId
        ? 'Deployment started. Completion is callback-driven and will be sent by webhook.'
        : 'Deployment started.',
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
});
