#!/usr/bin/env node

import {
  normalizeApiUrl,
  parseArgs,
} from '../lib/clikdeploy-client.mjs';
import { loadUserApiKey } from '../lib/local-auth-store.mjs';
import { performAutoOnboard } from '../lib/onboard.mjs';

async function main() {
  const rawArgv = process.argv.slice(2);
  const args = parseArgs(rawArgv);
  if (args.help || rawArgv.includes('-h')) {
    process.stdout.write('read skill.md\n');
    return;
  }
  const apiUrl = normalizeApiUrl(String(args['api-url'] || 'https://clikdeploy.com'));
  const apiKey = loadUserApiKey();
  if (!apiKey) {
    throw new Error('Missing user API key. Run auth flow first.');
  }

  const output = await performAutoOnboard({
    apiUrl,
    apiKey,
    name: args.name ? String(args.name) : undefined,
    callbackUrl: args['callback-url'] ? String(args['callback-url']) : undefined,
    waitForReady: args['no-wait'] ? false : true,
  });

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
});
