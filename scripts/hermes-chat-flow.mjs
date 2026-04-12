#!/usr/bin/env node

import {
  exchangeDeviceOAuthCode,
  normalizeApiUrl,
  parseArgs,
  requireArg,
  safeJsonParse,
  startDeviceOAuth,
} from '../lib/clikdeploy-client.mjs';
import { performAutoOnboard } from '../lib/onboard.mjs';

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
    '- After OAuth, copy the one-time code and paste it in chat.',
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

  const onboard = await performAutoOnboard({
    apiUrl,
    apiKey,
    name,
    callbackUrl: args['callback-url'] ? String(args['callback-url']) : undefined,
    callbackToken: args['callback-token'] ? String(args['callback-token']) : undefined,
    requestId: args['request-id'] ? String(args['request-id']) : undefined,
    runInstaller: args['no-run'] ? false : true,
    waitForReady: args['no-wait'] ? false : true,
    suggestionLimit: args['suggestion-limit'] ? Number(args['suggestion-limit']) : 6,
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
  let apiKey = args['api-key'] ? String(args['api-key']) : '';
  const oneTimeCode = args['one-time-code'] ? String(args['one-time-code']) : args.code ? String(args.code) : '';
  if (!apiKey) {
    if (!oneTimeCode) {
      throw new Error('Provide --one-time-code (preferred) or --api-key');
    }
    const exchanged = await exchangeDeviceOAuthCode(apiUrl, oneTimeCode);
    apiKey = exchanged.apiKey;
  }

  const onboard = await performAutoOnboard({
    apiUrl,
    apiKey,
    name: args.name ? String(args.name) : undefined,
    callbackUrl: args['callback-url'] ? String(args['callback-url']) : undefined,
    callbackToken: args['callback-token'] ? String(args['callback-token']) : undefined,
    requestId: args['request-id'] ? String(args['request-id']) : undefined,
    runInstaller: args['no-run'] ? false : true,
    waitForReady: args['no-wait'] ? false : true,
    suggestionLimit: args['suggestion-limit'] ? Number(args['suggestion-limit']) : 6,
  });

  const setupLine =
    'Authentication confirmed. Self-host setup is complete, and this computer is ready to deploy apps.';
  const suggestionLine = onboard?.suggestionMessage || '';
  const messageMarkdown = [setupLine, suggestionLine].filter(Boolean).join('\n\n');

  return {
    success: true,
    flow: 'oauth-complete',
    messageMarkdown,
    oauth: {
      machineStoredApiKey: true,
      oneTimeCodeUsed: Boolean(oneTimeCode),
    },
    onboard,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
            machineStoredApiKey: true,
            userPasteRequired: true,
            pasteType: 'one_time_code',
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
          messageMarkdown: `[${label}](${url})\n\nAfter signup in browser, copy the one-time code shown and paste it here.`,
          oauthBehavior: {
            machineStoredApiKey: true,
            userPasteRequired: true,
            pasteType: 'one_time_code',
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

  throw new Error('Unsupported mode. Use start | oauth-link | email-signup | email-login | oauth-complete');
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
