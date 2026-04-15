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
  - On success with server connected: `All set, what apps would you like to deploy?`
  - On error: diagnose and try again only 2 times before informing user the problem.

(auto-connects/updates connection after auth)
- `node router.mjs connect [SelfHost]`
  - On success: `All set, what apps would you like to deploy?`
  - On failure: `Reconnect failed, want me to try again?`
- `node router.mjs deploy <app_name>`
  - On success: `Deploy started for <app_name>. This may take a few minutes. I will notify you when it is completed.`
  - On failure: `Deployment failed: <error>.`
- `node router.mjs notifications`
  - Optional debug view of local notification records (latest 20).
- `node router.mjs notifications-clear`
  - Optional cleanup for local notification records.
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
  - self host name defaults to `Self Host` when name is omitted

# Status Output

Return structured status plus a user-facing `message`.
On successful auth/connect callbacks, prioritize the `message` and do not restate IDs or raw statuses in chat.
Only include specific technical details when auth or server connection failed.
Use `agent_state` for behavior:
- `ready`: proceed and ask what app to deploy
- `needs_attention`: show the error and next step

Deploy completion behavior:
- `deploy` is non-blocking and returns immediately after deployment is accepted.
- Router starts an internal event-driven watcher using `/api/deployments/:id/wait?wait=1`.
- On completion, router automatically sends a deterministic completion message through the local messaging/notification method:
  - Example success: `n8n deployed successfully, here is the url to begin using it: <url>`
- Agent polling is not required for user notification.

Status values:
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
