---
name: clikdeploy_deploy_skill
description: Minimal contract for ClikDeploy auth, local credential reuse, self-host setup, and app deploy.
version: 0.3.1
author: ClikDeploy
license: MIT
platforms:
  - linux
  - macos
  - windows
metadata:
  tags:
    - clikdeploy
    - self-host
    - deploy
    - dockerhub
    - onboarding
  activation:
    requires_any:
      - "sign up"
      - "connect my machine"
      - "deploy an app"
      - "deploy from docker hub"
    fallback_for_any:
      - "host an app"
  config_schema:
    type: object
    required:
      - api_url
    properties:
      api_url:
        type: string
        description: ClikDeploy base URL (default https://clikdeploy.com)
---

# Contract

1. API-only skill: call platform HTTP endpoints directly; do not invoke CLI commands.
2. Authenticate with device OAuth only (`/api/auth/cli/device/*`), handled by self-host agent.
3. Connect or reconnect self-host with `POST /api/agents/provision` before deploy.
4. After auth success, immediately connect or reconnect self-host.
5. Resolve app image from Docker Hub search on every deploy, then deploy using the resolved image name only.
6. Always emit authentication status and server connection status.
7. Prefer callback-driven status and report progress in chat.
8. Never expose raw API keys or secrets to AI chat output.
9. Self-host agent is the only component allowed to exchange/store credentials.

# Base Rules

- Default `api_url`: `https://clikdeploy.com`
- Transport: JSON requests/responses
- Auth header: bearer token from local store when available
- Auth method allowed: `device_flow` only (OAuth via `google` or `github`)
- OAuth browser entrypoint must be `authUrl` (never use `consentUrl` directly)
- Deploy input: image name only, resolved from `/api/docker-hub/search` every time
- Status reporting is mandatory in chat for auth and server connection
- Never print raw secrets in chat

# Local Auth

Store after successful platform auth (`device/exchange`) by self-host agent only.

- Linux/macOS: `${XDG_CONFIG_HOME:-~/.config}/clikdeploy/auth.json`
- Windows: `${APPDATA}/ClikDeploy/auth.json`
- Fallback: `~/.clikdeploy/auth.json`
- Optional compatibility token file: `~/.clikdeploy/api-key`

Minimum fields:
- `apiUrl`
- `apiKey` or `accessToken`
- `updatedAt`

Lookup precedence:
1. explicit runtime secret/arg
2. env override
3. local auth file
4. local api-key compatibility file
5. prompt re-auth

Security boundaries:
- AI may read auth status but must not print or transmit token values.
- Self-host performs credential write/update/delete operations.

# Endpoints

Auth:
- `/api/auth/cli/device/init`: `provider` (`google|github`), `returnUrl` (set `true`), then open `authUrl` as the canonical browser URL
- `/api/auth/cli/device/exchange`: `code`

Self-host:
- `/api/agents/provision`: connect or reconnect self-host; optional `name` (defaults server-side), `platform`, `arch`, `hostname`

Deploy:
- `/api/apps` (create + deploy)
- `/api/apps/:id/deploy` (redeploy)
- `/api/apps/:id` (DELETE app)

Server lifecycle:
- `/api/servers/:id` (DELETE server)

Search:
- `/api/docker-hub/search`: `q`

Advanced only (when caller needs webhook correlation):
- `callbackUrl`, `callbackToken`, `requestId`

# Endpoint Expectations (Verified)

Verified against `https://clikdeploy.com` on 2026-04-14 (America/Denver) / 2026-04-15 (UTC).

Auth endpoints:
- `POST /api/auth/cli/device/init`
  - requires `provider` = `google|github`
  - with `returnUrl=true`, returns `flowId`, `authUrl`, `consentUrl` (alias of `authUrl`), optional `providerConsentUrl`, `expiresInSec`
  - use `authUrl` as the browser entrypoint for consent flow
  - invalid provider -> `400` with provider validation error
- `POST /api/auth/cli/device/exchange`
  - requires `code`
  - missing or invalid code format -> `400`

Search endpoint:
- `GET /api/docker-hub/search?q=<term>`
  - missing `q` -> `400` (`VALIDATION_ERROR`)
  - valid query (example: `q=n8n`) -> `200` with `data.images[]`

Protected endpoints (bearer token required):
- `POST /api/agents/provision`
- `POST /api/apps`
- `POST /api/apps/:id/deploy`
- `DELETE /api/apps/:id`
- `DELETE /api/servers/:id`
- missing bearer token -> `401` auth required
- invalid bearer token format -> `401` (`AUTH_REQUIRED`)

# Flow

1. Load local auth.
2. If missing/invalid, authenticate with `device_flow` only:
- call `/api/auth/cli/device/init` with `provider` (`google` or `github`) and `returnUrl=true`
- instruct user to open returned `authUrl` and complete consent
- collect one-time code through self-host secure input path (not AI chat)
- self-host calls `/api/auth/cli/device/exchange` with that code
3. Self-host persists returned credential locally (`auth.json`, and `api-key` compatibility file when available).
4. Connect or reconnect self-host with `POST /api/agents/provision`.
5. Always resolve app name through `/api/docker-hub/search`, then deploy with the resolved image name.
6. Return URL + status updates, including explicit auth and server status.
7. On user request, support cleanup actions:
- delete app via `/api/apps/:id`
- delete server via `/api/servers/:id`
- revoke auth by wiping local auth file (and revoke remote key only if a revoke endpoint is available)

# Callback Events

- `auth_valid`
- `auth_required`
- `auth_refreshed`
- `auth_failed`
- `self_host_ready`
- `self_host_failed`
- `app_deploy_started`
- `app_deployed`
- `app_deploy_failed`

# Status Contract

Use these exact status values when reporting progress:

- Auth status: `auth_valid` | `auth_required` | `auth_refreshed` | `auth_failed`
- Server status: `server_connecting` | `server_connected` | `server_reconnecting` | `server_reconnect_failed`

Auth status payload must also include:

- `auth_method`: `google` | `github` | `unknown`
- `is_authenticated`: `true` | `false`

# Execution Checklist (Required)

Before deploy, the agent must complete this checklist in order:

1. Confirm `api_url` and load local auth from canonical files.
2. If auth is missing/invalid, run device flow with `returnUrl=true`.
3. Present only `authUrl` to user (do not present `consentUrl` as primary).
4. Ensure one-time code handling stays in self-host secure path.
5. Exchange code via `/api/auth/cli/device/exchange`.
6. Persist updated credential locally via self-host.
7. Emit `auth_valid` and `is_authenticated=true` on success.
8. Call `POST /api/agents/provision` and emit server connection status.
9. Resolve image via `/api/docker-hub/search` and deploy via `/api/apps`.
10. Never output secrets in chat at any point.

# Error Policy

- `401/403`: re-auth and replace local credential
- `404`: verify `api_url` or resource id
- `409`: for `/api/agents/provision`, treat already-exists/active as successful reconnect
- `422`: show missing/invalid input
- `429/5xx`: retry with capped exponential backoff
