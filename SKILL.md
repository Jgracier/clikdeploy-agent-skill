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

1. Call platform endpoints directly.
2. Authenticate once, persist local credential, and reuse it for later calls.
3. Connect or reconnect self-host with `POST /api/agents/provision` before deploy.
4. After auth success, immediately connect or reconnect self-host.
5. Deploy using image name only; platform handles runtime details.
6. Prefer callback-driven status and report progress in chat.

# Base Rules

- Default `api_url`: `https://clikdeploy.com`
- Transport: JSON requests/responses
- Auth header: bearer token from local store when available
- Deploy input: image name only
- Never print raw secrets in chat

# Local Auth

Store after successful auth (`signup`, `login`, or `device/exchange`).

- Linux/macOS: `${XDG_CONFIG_HOME:-~/.config}/clikdeploy/auth.json`
- Windows: `${APPDATA}/ClikDeploy/auth.json`
- Fallback: `~/.clikdeploy/auth.json`

Minimum fields:
- `apiUrl`
- `apiKey` or `accessToken`
- `updatedAt`

Lookup precedence:
1. explicit runtime secret/arg
2. env override
3. local auth file
4. prompt re-auth

# Endpoints

Auth:
- `/api/auth/cli/device/init`: `provider` (`google|github`), `returnUrl` (set `true` so response may include `consentUrl` in addition to `authUrl`)
- `/api/auth/cli/device/exchange`: `code`
- `/api/auth/cli/signup`: `email`, `password`, optional `name`
- `/api/auth/cli/login`: `email`, `password`

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

# Flow

1. Load local auth.
2. If missing/invalid, offer auth options:
- email/password signup or login
- OAuth device flow (`google` or `github`) with `returnUrl=true`, user pastes one-time code
3. Persist returned credential locally.
4. Connect or reconnect self-host with `POST /api/agents/provision`.
5. Deploy app with image name (directly or selected from search results).
6. Return URL + status updates.
7. On user request, support cleanup actions:
- delete app via `/api/apps/:id`
- delete server via `/api/servers/:id`
- revoke auth by wiping local auth file (and revoke remote key only if a revoke endpoint is available)

# Callback Events

- `self_host_ready`
- `self_host_failed`
- `app_deploy_started`
- `app_deployed`
- `app_deploy_failed`

# Error Policy

- `401/403`: re-auth and replace local credential
- `404`: verify `api_url` or resource id
- `409`: for `/api/agents/provision`, treat already-exists/active as successful reconnect
- `422`: show missing/invalid input
- `429/5xx`: retry with capped exponential backoff
