#!/usr/bin/env node

import {
  normalizeApiUrl,
  parseArgs,
  requireArg,
  safeJsonParse,
} from '../lib/clikdeploy-client.mjs';
import { performAutoOnboard } from '../lib/onboard.mjs';

function getProviderLink(apiUrl, provider) {
  const p = String(provider || '').toLowerCase();
  if (p !== 'google' && p !== 'github') {
    throw new Error('Provider must be google or github');
  }
  return `${normalizeApiUrl(apiUrl)}/api/auth/signin/${p}`;
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

function formatStartMessage(apiUrl) {
  const base = normalizeApiUrl(apiUrl);
  const google = `${base}/api/auth/signin/google`;
  const github = `${base}/api/auth/signin/github`;
  return [
    'Sign up to deploy apps to this machine:',
    `- [Sign up with Google](${google})`,
    `- [Sign up with GitHub](${github})`,
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
  const apiKey = requireArg(args, 'api-key');
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
    onboard,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = String(args.mode || 'start').toLowerCase();
  const apiUrl = normalizeApiUrl(String(args['api-url'] || 'https://clikdeploy.com'));

  if (mode === 'start') {
    process.stdout.write(
      `${JSON.stringify(
        {
          success: true,
          flow: 'start',
          messageMarkdown: formatStartMessage(apiUrl),
          options: [
            { id: 'email_password', label: 'Email + Password' },
            { id: 'google_oauth', label: 'Sign up with Google', url: `${apiUrl}/api/auth/signin/google` },
            { id: 'github_oauth', label: 'Sign up with GitHub', url: `${apiUrl}/api/auth/signin/github` },
          ],
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (mode === 'oauth-link') {
    const provider = requireArg(args, 'provider');
    const url = getProviderLink(apiUrl, provider);
    const label = String(provider).toLowerCase() === 'google' ? 'Sign up with Google' : 'Sign up with GitHub';
    process.stdout.write(
      `${JSON.stringify(
        {
          success: true,
          flow: 'oauth-link',
          provider,
          url,
          messageMarkdown: `[${label}](${url})`,
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
