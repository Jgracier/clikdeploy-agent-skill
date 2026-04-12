#!/usr/bin/env node

import {
  normalizeApiUrl,
  parseArgs,
  startDeviceOAuth,
} from '../lib/clikdeploy-client.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiUrl = normalizeApiUrl(String(args['api-url'] || 'https://clikdeploy.com'));

  const [googleConsentUrl, githubConsentUrl] = await Promise.all([
    startDeviceOAuth(apiUrl, 'google').then((result) => result.authUrl),
    startDeviceOAuth(apiUrl, 'github').then((result) => result.authUrl),
  ]);

  const output = {
    apiUrl,
    messageMarkdown: [
      'Sign up to deploy apps to this machine:',
      `- [Sign up with Google](${googleConsentUrl})`,
      `- [Sign up with GitHub](${githubConsentUrl})`,
      '- Or use email/password signup/login in chat.',
      '- After OAuth, copy the one-time code shown and paste it in chat.',
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
      'After OAuth, user pastes the one-time code in chat. Setup then completes automatically.',
    oauthBehavior: {
      requiresOneTimeCode: true,
    },
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
