---
name: clikdeploy_deploy_skill
description: Minimal API contract for one-time-code auth, self host connect, and app deploy.
version: 0.5.0
author: ClikDeploy
license: MIT
platforms:
  - linux
  - macos
  - windows
---

# Commands

The commands below contain ALL needed communication with secure execution.

- `node router.mjs auth-status`
  - If authenticated: `Authentication is valid.`
  - If not authenticated: `Authentication required. Run auth-init first.`

- `node router.mjs auth-init google`
  - Example wordage: `Open this login URL to continue: <auth_url>. After consent, paste the one-time code here.`

- `node router.mjs auth-init github`
  - Example wordage: `Open this login URL to continue: <auth_url>. After consent, paste the one-time code here.`

- `node router.mjs auth-exchange <ONE_TIME_CODE>` # User submits 1 time generated code for secure api key exchange
  - On success with server connected: `Authentication complete. Self host connected. What app would you like to deploy?`
  - On error: diagnose and try again only 2 times before informing user the problem.

(auto-connects/updates connection after auth)
- `node router.mjs connect [SelfHost]`
  - On success: `Connection is up and healthy. What app would you like to deploy?`
  - On failure: `Reconnect failed, want me to try again?`
- `node router.mjs deploy <app_name>`
  - On success: `Deployment started successfully for <app_name>.`
  - On failure: `Deployment failed: <error>.`
- `node router.mjs list-apps`
- `node router.mjs list-servers`
- `node router.mjs delete-app <id>`
- `node router.mjs delete-server <id>`

# API Gate Contract (standardized)

- `POST /api/gate/auth/device/exchange` supports: `code`, `autoConnect`, `name`, `waitForHealthy`, `waitTimeoutMs`
- `POST /api/gate/connect` supports: `name`, `waitForHealthy`, `waitTimeoutMs`
- Defaults are platform-owned:
  - `autoConnect: true`
  - `waitForHealthy: true`
  - self host name defaults to `<hostname> (Self Host)` when name is omitted

# Status Output

Return only:
- `auth_required` | `auth_valid` | `auth_failed`
- `server_connected` | `server_reconnect_failed`
- `app_deploy_started` | `app_deploy_failed`

Auth payload fields:
- `auth_method`: `google` | `github` | `unknown`
- `is_authenticated`: `true` | `false`

# Error Rules

- `401/403`: re-auth via device flow
- `409` on provision: treat active/already-exists as connected
- `422`: report invalid input
- `429/5xx`: retry with capped backoff
