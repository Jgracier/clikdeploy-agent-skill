#!/usr/bin/env node

import {
  normalizeApiUrl,
  parseArgs,
} from '../lib/clikdeploy-client.mjs';

function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiUrl = normalizeApiUrl(String(args['api-url'] || 'https://clikdeploy.com'));

  const output = {
    apiUrl,
    messageMarkdown: [
      'Sign up to deploy apps to this machine:',
      `- [Sign up with Google](${apiUrl}/api/auth/signin/google)`,
      `- [Sign up with GitHub](${apiUrl}/api/auth/signin/github)`,
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
        url: `${apiUrl}/api/auth/signin/google`,
      },
      {
        id: 'github_oauth',
        label: 'GitHub OAuth',
        description: 'Continue in browser via GitHub account.',
        url: `${apiUrl}/api/auth/signin/github`,
      },
    ],
    nextStep:
      'After sign-up finishes, this machine will be connected automatically and ready for app deployments.',
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();
