import { spawn } from 'node:child_process';
import os from 'node:os';
import {
  apiRequest,
  buildLinuxInstallerCommand,
  buildWindowsInstallerCommand,
  defaultMachineName,
  getMarketplaceApps,
  getPopularMarketplaceSuggestions,
  normalizeApiUrl,
} from './clikdeploy-client.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function postCallback(callbackUrl, callbackToken, payload, options = {}) {
  if (!callbackUrl) return { delivered: false, skipped: true, attempts: 0 };
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 5));
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (callbackToken) headers.Authorization = `Bearer ${callbackToken}`;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let response;
      try {
        response = await fetch(callbackUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (response.ok) {
        return { delivered: true, skipped: false, attempts: attempt };
      }
      lastError = new Error(`Callback HTTP ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < maxAttempts) {
      const delayMs = Math.min(8000, 500 * 2 ** (attempt - 1));
      await sleep(delayMs);
    }
  }
  return {
    delivered: false,
    skipped: false,
    attempts: maxAttempts,
    error: lastError instanceof Error ? lastError.message : 'Callback delivery failed',
  };
}

function runCommand(command, platform) {
  return new Promise((resolve, reject) => {
    const child =
      platform === 'win32'
        ? spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
            stdio: 'inherit',
            shell: false,
          })
        : spawn('bash', ['-lc', command], {
            stdio: 'inherit',
            shell: false,
          });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`Installer exited with code ${code}`));
    });
  });
}

async function waitForInstallConfirmation(apiUrl, token, wait) {
  const query = wait ? '?wait=1' : '';
  const url = `${normalizeApiUrl(apiUrl)}/api/agents/install-report${query}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { success: false, raw: text };
  }
  if (!res.ok) {
    const msg = payload?.error || `Install confirmation failed (${res.status})`;
    throw new Error(msg);
  }
  return payload;
}

export async function performAutoOnboard({
  apiUrl,
  apiKey,
  name,
  callbackUrl,
  callbackToken,
  requestId,
  runInstaller = true,
  waitForReady = true,
  suggestionLimit = 6,
}) {
  const machineName = defaultMachineName(name);
  const platform = os.platform();
  const arch = os.arch();
  const hostname = os.hostname();

  try {
    const provisionPayload = await apiRequest(apiUrl, apiKey, '/api/agents/provision', {
      method: 'POST',
      body: {
        name: machineName,
        platform,
        arch,
        hostname,
      },
    });

    const data = provisionPayload?.data || provisionPayload;
    const agentId = data?.agentId;
    const serverId = data?.serverId;
    const token = data?.token;

    if (!agentId || !serverId || !token) {
      throw new Error('Provisioning response missing agentId/serverId/token');
    }

    const selectedCommand =
      platform === 'win32'
        ? buildWindowsInstallerCommand(apiUrl, token, serverId, agentId)
        : buildLinuxInstallerCommand(apiUrl, token, serverId, agentId);

    let installerRan = false;
    if (runInstaller) {
      await runCommand(selectedCommand, platform);
      installerRan = true;
    }

    // The platform installer already blocks on readiness via long-poll.
    // Only do an explicit readiness wait when installer execution is skipped.
    if (waitForReady && !runInstaller) {
      await waitForInstallConfirmation(apiUrl, token, true);
    }

    let suggestedApps = [];
    try {
      const marketplaceApps = await getMarketplaceApps(apiUrl, apiKey);
      suggestedApps = getPopularMarketplaceSuggestions(marketplaceApps, suggestionLimit);
    } catch {
      suggestedApps = [];
    }

    const suggestionNames = suggestedApps
      .map((item) => item.name)
      .filter((item) => typeof item === 'string' && item.trim().length > 0)
      .slice(0, 4);
    const suggestionMessage =
      suggestionNames.length > 0
        ? `Here are some apps users find helpful: ${suggestionNames.join(', ')}.`
        : 'Your machine is ready. Ask me to deploy any Docker Hub app.';

    const output = {
      success: true,
      event: 'self_host_ready',
      requestId: requestId || null,
      machineName,
      serverId,
      installerRan,
      readyMessage: 'You are ready to deploy apps to this machine.',
      suggestionMessage,
      suggestedApps,
    };

    await postCallback(callbackUrl, callbackToken, output);
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await postCallback(callbackUrl, callbackToken, {
      success: false,
      event: 'self_host_failed',
      requestId: requestId || null,
      error: message,
    });
    throw error;
  }
}
