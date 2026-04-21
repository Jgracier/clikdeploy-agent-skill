---
name: clikdeploy_deploy_skill
description: Simple contract for auth, connect, and deploy with ClikDeploy CLI.
version: 0.6.0
author: ClikDeploy
---

## Repo Source
- Skill repo: `https://github.com/Jgracier/clikdeploy-agent-skill.git`
- Quick update: `git -C ~/.hermes/skills/clikdeploy-agent pull --ff-only origin main`

# Use These Commands

## Auth (auto-provisions self-host — no separate `connect` needed)
- `clikdeploy whoami` # Check current auth status
- `clikdeploy login-url --google | --github` # Login with Google or GitHub and wait for 1 time code
- `clikdeploy login --exchange <ONE_TIME_CODE>` # Exchanges code for API key, installs agent, and connects server automatically.

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
- Root cause: `.tmp-diag.ts` in the vendored CLI writes localhost into config when run
- Safeguards in `config.ts` and `client.ts` detect localhost and warn/ignore — but `.tmp-diag.ts` runs before they can help
- Must fix `.tmp-diag.ts` in **both** the vendored `.tgz` AND the source project at `/home/justin-gracier/Desktop/clikdeploy/apps/cli/.tmp-diag.ts`

## Updating the vendored CLI
- Source CLI lives at `/home/justin-gracier/Desktop/clikdeploy/apps/cli/` (package.json has the version)
- Build from source: `cd <source>/apps/cli && npm run build && npm pack`
- Copy `.tgz` to `vendor/cli/` in the skill repo, delete the old version
- Update `setup.mjs` to reference the new `.tgz` filename
- Also fix `.tmp-diag.ts` in the **source project** if it hardcodes localhost — otherwise it ships in the next `.tgz`
- Commit and push to GitHub
- Locally: `npm install -g <path>/clikdeploy-cli-<ver>.tgz` then `cd ~/.hermes/skills/clikdeploy-agent && npm link --force`

## Reinstall after wipe/clone
- `cd ~/.hermes/skills/clikdeploy-agent && npm link --force`
- Verify: `which clikdeploy && clikdeploy --help`

## Platform errors
- If `whoami` works but `list`/`status`/`deploy` return "Internal server error", triage by probing Gate endpoints directly:
  - `clikdeploy whoami` (auth sanity)
  - `clikdeploy status` and `clikdeploy list`
  - Optional raw check: `/api/gate/auth/me` and `/api/gate/discovery` should return 200 while `/api/gate/apps` and `/api/gate/servers` returning 500 indicates control-plane/API failure
- Local stack fast-check:
  - `docker ps -a | grep clikdeploy-app`
  - `docker logs --tail 200 clikdeploy-app`
- Known failure signature observed: `Error: Cannot find module 'next'` from `/api/server.ts` causes `clikdeploy-app` to exit and Gate endpoints to fail with internal errors.
- Conclusion: when this signature appears, it is not a CLI auth/config issue; fix/restart the platform app container/build.
