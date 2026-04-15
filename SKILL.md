---
name: clikdeploy_deploy_skill
description: Minimal API contract for one-time-code auth, self-host connect, and app deploy.
version: 0.5.0
author: ClikDeploy
license: MIT
platforms:
  - linux
  - macos
  - windows
---

# Contract

1. API-only: call platform HTTP endpoints directly.
2. Use one auth path only: device OAuth one-time code.
3. Use router only: `node router.mjs <command> [args]`.
4. Never read or print API keys in agent logic.
5. Never print secrets in chat.

# Router Rule

Use only this file for all skill actions:
- `router.mjs`

The router handles local auth storage and authenticated calls internally.
The agent receives status JSON only.

# Endpoints (router calls these)

Auth:
- `POST /api/auth/cli/device/init` (`provider`: `google|github`, `returnUrl: true`)
- `POST /api/auth/cli/device/exchange` (`code`)

Self-host:
- `POST /api/agents/provision`

Deploy:
- `GET /api/docker-hub/search?q=<name>`
- `POST /api/apps`
- `POST /api/apps/:id/deploy`
- `DELETE /api/apps/:id`
- `DELETE /api/servers/:id`

# Commands

- `node router.mjs auth-status`
- `node router.mjs auth-init --provider google`
- `node router.mjs auth-init --provider github`
- `node router.mjs auth-exchange --code <ONE_TIME_CODE> --provider google|github`
- `node router.mjs server-connect [--name "Home"]`
- `node router.mjs server-reconnect [--name "Home"]`
- `node router.mjs image-resolve --name wordpress`
- `node router.mjs app-deploy --name wordpress [--server-id <id>]`
- `node router.mjs app-delete --app-id <id>`
- `node router.mjs server-delete --server-id <id>`

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
