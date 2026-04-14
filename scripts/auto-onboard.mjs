#!/usr/bin/env node

import {
  normalizeApiUrl,
  parseArgs,
  requireArg,
} from '../lib/clikdeploy-client.mjs';
import { performAutoOnboard } from '../lib/onboard.mjs';

async function main() {
  const rawArgv = process.argv.slice(2);
  const args = parseArgs(rawArgv);
  if (args.help || rawArgv.includes('-h')) {
    process.stdout.write('read skill.md\n');
    return;
  }
  const apiUrl = normalizeApiUrl(String(args['api-url'] || 'https://clikdeploy.com'));
  const apiKey = requireArg(args, 'api-key');

  const output = await performAutoOnboard({
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

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
});
