#!/usr/bin/env node

import {
  getCliOauthConsentUrl,
  normalizeApiUrl,
  parseArgs,
} from '../lib/clikdeploy-client.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiUrl = normalizeApiUrl(String(args['api-url'] || 'https://clikdeploy.com'));
  const callbackUrl = args['callback-url'] ? String(args['callback-url']) : undefined;
  const port = args.port ? String(args.port) : undefined;

  const [googleConsentUrl, githubConsentUrl] = await Promise.all([
    getCliOauthConsentUrl(apiUrl, 'google', { port, callbackUrl }),
    getCliOauthConsentUrl(apiUrl, 'github', { port, callbackUrl }),
  ]);

  const output = {
    apiUrl,
    messageMarkdown: [
      'Sign up to deploy apps to this machine:',
      `- [Sign up with Google](${googleConsentUrl})`,
      `- [Sign up with GitHub](${githubConsentUrl})`,
      '- Or use email/password signup/login in chat.',
    ].join('\n'),
    options: [
      {
        id: 'email_password',
        label: 'Email + Password',
        description: 'Sign up or log in with email credentials.',
        paths: {
          signupApi: '/api/auth/cli/signup',
          loginApi: '/api/auth/cli/login',
        },
      },
      {
        id: 'google_oauth',
        label: 'Google OAuth',
        description: 'Continue in browser via Google account.',
        url: googleConsentUrl,
      },
      {
        id: 'github_oauth',
        label: 'GitHub OAuth',
        description: 'Continue in browser via GitHub account.',
        url: githubConsentUrl,
      },
    ],
    nextStep:
      'After sign-up finishes, machine setup and deploy key handling are automatic; this machine is then ready for app deployments.',
    oauthBehavior: {
      machineStoredApiKey: true,
      userPasteRequired: false,
    },
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
