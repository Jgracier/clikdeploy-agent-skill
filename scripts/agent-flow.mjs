#!/usr/bin/env node

import {
  exchangeDeviceOAuthCode,
  getServers,
  normalizeApiUrl,
  parseArgs,
  requireArg,
  safeJsonParse,
  startDeviceOAuth,
} from '../lib/clikdeploy-client.mjs';
import { performAutoOnboard } from '../lib/onboard.mjs';
import { clearUserApiKey, loadUserApiKey, saveUserApiKey } from '../lib/local-auth-store.mjs';

async function getProviderLink(apiUrl, provider) {
  const init = await startDeviceOAuth(apiUrl, provider);
  return init.authUrl;
}

async function publicJsonRequest(apiUrl, path, body) {
  const res = await fetch(`${normalizeApiUrl(apiUrl)}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  const payload = safeJsonParse(text, { raw: text });
  if (!res.ok) {
    throw new Error(payload?.error || payload?.message || `Request failed (${res.status})`);
  }
  return payload;
}

function formatStartMessage(googleUrl, githubUrl) {
  return [
    'Sign up to deploy apps to this machine:',
    `- [Sign up with Google](${googleUrl})`,
    `- [Sign up with GitHub](${githubUrl})`,
    '- After OAuth, copy the one-time code and paste it in this session.',
    '- Or reply with email signup/login and provide email + password.',
  ].join('\n');
}

async function runEmailAuthAndOnboard(mode, args, apiUrl) {
  const email = requireArg(args, 'email');
  const password = requireArg(args, 'password');
  const name = args.name ? String(args.name) : undefined;

  const path = mode === 'email-signup' ? '/api/auth/cli/signup' : '/api/auth/cli/login';
  const payload =
    mode === 'email-signup'
      ? await publicJsonRequest(apiUrl, path, { email, password, name })
      : await publicJsonRequest(apiUrl, path, { email, password });

  const data = payload?.data || payload;
  const apiKey = data?.apiKey;
  if (!apiKey) {
    throw new Error('Authentication succeeded but no apiKey was returned');
  }
  saveUserApiKey(apiKey);

  const onboard = await performAutoOnboard({
    apiUrl,
    apiKey,
    name,
    callbackUrl: args['callback-url'] ? String(args['callback-url']) : undefined,
    waitForReady: args['no-wait'] ? false : true,
  });

  const setupLine = 'Signup complete. Self-host setup is complete, and this computer is ready to deploy apps.';
  const suggestionLine = onboard?.suggestionMessage || '';
  const messageMarkdown = [setupLine, suggestionLine].filter(Boolean).join('\n\n');

  return {
    success: true,
    flow: mode,
    messageMarkdown,
    auth: {
      email,
      authenticated: true,
    },
    onboard,
  };
}

async function runOauthComplete(args, apiUrl) {
  const oneTimeCode = args['one-time-code'] ? String(args['one-time-code']) : args.code ? String(args.code) : '';
  if (!oneTimeCode) {
    throw new Error('Missing required argument: --one-time-code');
  }
  const exchanged = await exchangeDeviceOAuthCode(apiUrl, oneTimeCode);
  const apiKey = exchanged.apiKey;
  saveUserApiKey(apiKey);

  const onboard = await performAutoOnboard({
    apiUrl,
    apiKey,
    name: args.name ? String(args.name) : undefined,
    callbackUrl: args['callback-url'] ? String(args['callback-url']) : undefined,
    waitForReady: args['no-wait'] ? false : true,
  });

  const setupLine =
    'Authentication confirmed. This machine is ready to deploy apps.';
  const suggestionLine = onboard?.suggestionMessage || '';
  const messageMarkdown = [setupLine, suggestionLine].filter(Boolean).join('\n\n');

  return {
    success: true,
    flow: 'oauth-complete',
    messageMarkdown,
    oauth: {
      requiresOneTimeCode: true,
      oneTimeCodeUsed: Boolean(oneTimeCode),
    },
    onboard,
  };
}

async function runReconnect(args, apiUrl) {
  const apiKey = loadUserApiKey();
  if (!apiKey) {
    throw new Error(
      'Missing user API key. Sign in first with email/password or OAuth completion.'
    );
  }

  const onboard = await performAutoOnboard({
    apiUrl,
    apiKey,
    name: args.name ? String(args.name) : undefined,
    callbackUrl: args['callback-url'] ? String(args['callback-url']) : undefined,
    runInstaller: true,
    waitForReady: true,
  });

  return {
    success: true,
    flow: 'reconnect',
    messageMarkdown: 'Reconnect complete. This machine is ready to deploy apps.',
    reconnect: {
      completed: true,
    },
    onboard,
  };
}

async function runAuthStatus(args, apiUrl) {
  const apiKey = loadUserApiKey();
  if (!apiKey) {
    return {
      success: true,
      flow: 'auth-status',
      auth: {
        authenticated: false,
        hasStoredApiKey: false,
        validated: false,
      },
      messageMarkdown: 'Not authenticated.',
    };
  }

  try {
    const servers = await getServers(apiUrl, apiKey);
    return {
      success: true,
      flow: 'auth-status',
      auth: {
        authenticated: true,
        hasStoredApiKey: true,
        validated: true,
        serverCount: Array.isArray(servers) ? servers.length : 0,
      },
      messageMarkdown: 'Authenticated.',
    };
  } catch (error) {
    return {
      success: true,
      flow: 'auth-status',
      auth: {
        authenticated: false,
        hasStoredApiKey: true,
        validated: true,
        error: error instanceof Error ? error.message : String(error),
      },
      messageMarkdown: 'Not authenticated.',
    };
  }
}

function runLogout() {
  const cleared = clearUserApiKey();
  return {
    success: true,
    flow: 'logout',
    auth: {
      authenticated: false,
      keyCleared: cleared,
    },
    messageMarkdown: cleared ? 'Logged out. Local authentication has been cleared.' : 'Already logged out.',
  };
}

async function main() {
  const rawArgv = process.argv.slice(2);
  const args = parseArgs(rawArgv);
  if (args.help || rawArgv.includes('-h')) {
    process.stdout.write('read skill.md\n');
    return;
  }
  const mode = String(args.mode || 'start').toLowerCase();
  const apiUrl = normalizeApiUrl(String(args['api-url'] || 'https://clikdeploy.com'));

  if (mode === 'start') {
    const [googleUrl, githubUrl] = await Promise.all([
      startDeviceOAuth(apiUrl, 'google').then((result) => result.authUrl),
      startDeviceOAuth(apiUrl, 'github').then((result) => result.authUrl),
    ]);

    process.stdout.write(
      `${JSON.stringify(
        {
          success: true,
          flow: 'start',
          messageMarkdown: formatStartMessage(googleUrl, githubUrl),
          options: [
            { id: 'email_password', label: 'Email + Password' },
            { id: 'google_oauth', label: 'Sign up with Google', url: googleUrl },
            { id: 'github_oauth', label: 'Sign up with GitHub', url: githubUrl },
          ],
          oauthBehavior: {
            requiresOneTimeCode: true,
          },
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (mode === 'oauth-link') {
    const provider = requireArg(args, 'provider');
    const url = await getProviderLink(apiUrl, provider);
    const label = String(provider).toLowerCase() === 'google' ? 'Sign up with Google' : 'Sign up with GitHub';
    process.stdout.write(
      `${JSON.stringify(
        {
          success: true,
          flow: 'oauth-link',
          provider,
          url,
          messageMarkdown: `[${label}](${url})\n\nAfter signup in browser, copy the one-time code shown and paste it in this session.`,
          oauthBehavior: {
            requiresOneTimeCode: true,
          },
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (mode === 'email-signup' || mode === 'email-login') {
    const output = await runEmailAuthAndOnboard(mode, args, apiUrl);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (mode === 'oauth-complete') {
    const output = await runOauthComplete(args, apiUrl);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (mode === 'auth-status') {
    const output = await runAuthStatus(args, apiUrl);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (mode === 'logout') {
    const output = runLogout();
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (mode === 'reconnect' || mode === 'connect') {
    const output = await runReconnect(args, apiUrl);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  throw new Error(
    'Unsupported mode. Use start | oauth-link | email-signup | email-login | oauth-complete | auth-status | logout | reconnect | connect'
  );
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
