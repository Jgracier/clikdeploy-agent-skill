---
name: clikdeploy_deploy_skill
description: Simple contract for auth, connect, and deploy with ClikDeploy CLI.
version: 0.6.0
author: ClikDeploy
---

# Use These Commands

## Auth
- `clikdeploy whoami` # Check current auth status
- `clikdeploy login-url --google | --github` # Login with Google or GitHub and wait for 1 time code. Must be returned to user as clickable link when available. Example of clickable link wording to markdown spec: [Login with Google | Github ](https://example.com/login?provider=google).
- `clikdeploy login --exchange <ONE_TIME_CODE>` # User will return a 1 time code to exchange for locally stored api key and self host connection. 

# All responses must be human-readable and clear.

## Structured Discovery
- `clikdeploy deploy` # no arg will return structured JSON of deployable apps from connected servers
- `clikdeploy status` # no arg will return structured JSON of status of apps from connected servers
- `clikdeploy list` # no arg will return structured JSON of connected servers and their apps
- `clikdeploy connect` # no arg, will return structured JSON of available server connection options, this skill is for the self host option.

## Deploy
- `clikdeploy deploy <app-name>` # Name only will resolve with dockerhub and deploy automatically. App will deploy to a single connected server immediately or will return list of servers if more than 1 to clarify which server to deploy to.


## Operate
- `clikdeploy status <app-or-server>`
- `clikdeploy logs <app>`
- `clikdeploy restart <app>`
- `clikdeploy stop <app>`
- `clikdeploy start <app>`
- `clikdeploy delete <app-or-server>`

# Rule

If a command cannot run without clarification use the structured JSON clarification response and follow the provided format to ask the user for more information.

# Troubleshooting

## API URL wrong (localhost instead of production)
- Check: `clikdeploy config` — look for `api-url`
- Fix: `clikdeploy config api-url https://clikdeploy.com`
- The CLI binary defaults to `https://clikdeploy.com` (in `dist/constants.js`), but saved config overrides it
- Root cause is often `.tmp-diag.ts` in the vendored CLI writing localhost into config

## Updating the vendored CLI
- CLI source is bundled as `vendor/cli/clikdeploy-cli-<version>.tgz`
- To fix: `cd /tmp && tar xzf <path>/clikdeploy-cli-<ver>.tgz`, edit files in `package/`, repack with `tar czf`, replace the `.tgz`, commit and push
- After repacking: `cd ~/.hermes/skills/clikdeploy-agent && npm link --force`

## Reinstall after wipe/clone
- `cd ~/.hermes/skills/clikdeploy-agent && npm link --force`
- Verify: `which clikdeploy && clikdeploy --help`
