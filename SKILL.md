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

The `clikdeploy` CLI contains ALL needed communication with secure execution.

<<<<<<< HEAD
- `clikdeploy whoami --json`
  - If authenticated: `is_authenticated: true`
  - If not authenticated: `is_authenticated: false`

- `clikdeploy login --google --return-url`
  - Example wordage: `Open this login URL to continue: <authUrl>. After consent, paste the one-time code here.`

- `clikdeploy login --github --return-url`
  - Example wordage: `Open this login URL to continue: <authUrl>. After consent, paste the one-time code here.`

- `clikdeploy login --exchange <ONE_TIME_CODE>`
  - trades code for `apiKey`, saves it globally, provisions the server, and installs the agent.
  - On success: `All set, what apps would you like to deploy?`
  - On error: diagnose and try again.

- `clikdeploy servers list` (or `clikdeploy servers status`)
  - Use this to verify whether Self Host is connected.

- `clikdeploy servers connect self-host`
  - Manual reconnect/re-provision for self-host agent.

- `clikdeploy marketplace deploy <app_name>`
  - On success: `Deploy started for <app_name>. I will notify you when it completes.`

- `clikdeploy notifications list --json`
  - Check for deployment completion or error messages (latest 20).

- `clikdeploy notifications clear --json`
  - Cleanup for notification history.

- `clikdeploy apps list`
- `clikdeploy servers list`
- `clikdeploy apps delete <id>`
- `clikdeploy servers delete <id>`
=======
- `ClikDeploy auth-status`
  - If authenticated: `Authentication is valid.`
  - If not authenticated: `Authentication required. Run auth-init first.`

- `ClikDeploy auth-init google`
  - Example wordage: `Open this login URL to continue: <auth_url>. After consent, paste the one-time code here.`

- `ClikDeploy auth-init github`
  - Example wordage: `Open this login URL to continue: <auth_url>. After consent, paste the one-time code here.`

- `ClikDeploy auth-exchange <ONE_TIME_CODE>` # User submits 1 time generated code for secure api key exchange
  - On success with server connected: `All set, what apps would you like to deploy?`
  - On error: diagnose and try again only 2 times before informing user the problem.

(auto-connects/updates connection after auth)
- `ClikDeploy server-status`
  - Non-mutating status check.
  - Use this to verify whether Self Host is connected.
- `ClikDeploy connect`
  - On success: `All set, what apps would you like to deploy?`
  - On failure: `Reconnect failed, want me to try again?`
- `ClikDeploy deploy <app_name>`
  - On success: `Deploy started for <app_name>. This may take a few minutes. I will notify you when it is completed.`
  - On failure: `Deployment failed: <error>.`
- `ClikDeploy notifications`
  - Optional debug view of local notification records (latest 20).
- `ClikDeploy notifications-clear`
  - Optional cleanup for local notification records.
- `ClikDeploy list-apps`
- `ClikDeploy list-servers`
- `ClikDeploy delete-app <id>`
- `ClikDeploy delete-server <id>`
>>>>>>> d552c5311881c43e9451e50cf46f8b4558130716

# API Gate Contract (standardized)

- `POST /api/gate/auth/device/exchange` supports: `code`, `autoConnect`, `name`, `waitForHealthy`, `waitTimeoutMs`
- `POST /api/gate/connect` supports: `name`, `waitForHealthy`, `waitTimeoutMs`
- Defaults are platform-owned:
  - `autoConnect: true`
  - `waitForHealthy: false` for skill/CLI; readiness is validated client-side via installer + status checks
  - self host name defaults to `Self Host` when name is omitted

# Status Output

Return structured status plus a user-facing `message`.
On successful auth/connect callbacks, prioritize the `message` and do not restate IDs or raw statuses in chat.
Only include specific technical details when auth or server connection failed.
Use `agent_state` for behavior:
- `ready`: proceed and ask what app to deploy
- `needs_attention`: show the error and next step

Status check rule:
- Do not call `connect` to check status.
- Call `server-status` for read-only verification.

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
