---
name: clikdeploy_deploy_skill
description: Minimal API contract for one-time-code auth, self-host connect, and app deploy.
version: 0.4.0
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
3. Use `authUrl` as the browser URL.
4. Exchange one-time code with platform, then store API key locally through self-host.
5. Never print secrets in chat.

# Base Rules

- Default `api_url`: `https://clikdeploy.com`
- Auth header: `Authorization: Bearer <apiKey>`
- Image resolution is required before deploy.
- Keep outputs to status only (no token values).

# Local Auth

Primary local files:
- `${XDG_CONFIG_HOME:-~/.config}/clikdeploy/auth.json`
- `~/.clikdeploy/api-key`

Required fields in `auth.json`:
- `apiUrl`
- `apiKey`
- `updatedAt`

# Endpoints

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

# Required Flow

1. Load local auth.
2. If missing/invalid, start device flow with `/api/auth/cli/device/init`.
3. Show user `authUrl`.
4. User completes consent and provides one-time code.
5. Call `/api/auth/cli/device/exchange` with code.
6. Hand returned API key to self-host local storage.
7. Connect/reconnect with `POST /api/agents/provision`.
8. Resolve image via `/api/docker-hub/search`.
9. Deploy with `POST /api/apps`.

# Status Output

Return only:
- `auth_required` | `auth_valid` | `auth_failed`
- `server_connecting` | `server_connected` | `server_reconnect_failed`
- `app_deploy_started` | `app_deployed` | `app_deploy_failed`

Auth payload fields:
- `auth_method`: `google` | `github` | `unknown`
- `is_authenticated`: `true` | `false`

# Error Rules

- `401/403`: re-auth via device flow
- `409` on provision: treat active/already-exists as connected
- `422`: report invalid input
- `429/5xx`: retry with capped backoff
