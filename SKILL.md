---
name: clikdeploy_deploy_skill
description: Use standardized ClikDeploy API endpoints for auth, local credential handling, self-host setup, app search, and app deploy.
version: 0.3.0
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
        description: ClikDeploy base URL (for example https://clikdeploy.com)
---

# Agent Contract

1. Use platform endpoints directly. Do not reimplement platform deploy/auth internals.
2. Keep onboarding short: authenticate, verify local readiness, then deploy on request.
3. Persist deploy credentials locally after successful auth so the user is not asked every turn.
4. Prefer the standardized endpoint and argument contract in this file.
5. Unknown extra arguments should be ignored unless endpoint validation rejects them.
6. Use short labeled clickable links in user-facing output when available.

# Platform Communication Rules

1. Default `api_url` to `https://clikdeploy.com` when not provided.
2. Build endpoints as `<api_url><path>` and avoid double slashes.
3. Use JSON request/response payloads.
4. Send bearer auth once local credentials exist.
5. Treat non-2xx as actionable errors and surface short, user-safe remediation.

# Local Auth Handling (Required)

Persist credentials locally after successful login/signup/device exchange.

## Storage

- Preferred auth file:
  - Linux/macOS: `${XDG_CONFIG_HOME:-~/.config}/clikdeploy/auth.json`
  - Windows: `${APPDATA}/ClikDeploy/auth.json`
- Fallback: `~/.clikdeploy/auth.json`

## Minimum stored fields

- `apiUrl`
- `apiKey` or `accessToken` (whatever deploy endpoints require)
- `user` (optional metadata)
- `updatedAt`

## Runtime precedence

1. Explicit runtime arg/secret override
2. Environment variable override
3. Stored local auth
4. Ask user to authenticate

## Security

1. Never print raw API keys/tokens in chat output.
2. Mask secrets in logs (`abcd...wxyz`).
3. Save with user-only file permissions where supported.

# Standard Endpoints And Arguments

## Auth (CLI)

- `/api/auth/cli/device/init`: `provider`
- `/api/auth/cli/device/exchange`: `code`
- `/api/auth/cli/signup`: `email`, `password`, optional `name`
- `/api/auth/cli/login`: `email`, `password`

Auth success action:
- Persist returned credential material to local auth store immediately.

## Self-Host Provision

- `/api/agents/provision`: `name`, optional `platform`, `arch`, `hostname`
- Callback args supported by default: `callbackUrl`, `callbackToken`, `requestId`

Self-host success action:
- Confirm machine is ready for deployment in user-facing output.

## App Create And Deploy

- `/api/apps` (create + deploy): required app/source fields per platform schema
- `/api/apps/:id/deploy` (redeploy): optional deploy overrides per platform schema
- Callback args supported by default: `callbackUrl`, `callbackToken`, `requestId`
- Deployment completion is platform webhook-callback driven.

## Docker Hub Search

- `/api/docker-hub/search`: `q`, optional `page`, `limit`

# Default Agent Flow

1. Check local auth availability.
2. If missing, offer auth options:
   - Email signup/login
   - OAuth device flow (user pastes one-time code from browser)
3. After auth success, persist local auth and continue without asking for key again.
4. Ensure self-host is provisioned (or reprovision if needed).
5. For deploy-by-intent:
   - If user provides image: deploy directly.
   - If user provides app intent/query: call Docker Hub search, pick best candidate, then deploy.
6. Return deployment URL/status and callback-driven progress updates.

# Callback Handling

Callback args (`callbackUrl`, `callbackToken`, `requestId`) should be passed through unchanged when provided.

Agent behavior:

1. Prefer callback-driven completion for provisioning/deploy.
2. Correlate callbacks by `requestId` when present.
3. Validate callback token when platform sends one.
4. If callback is absent, use short polling fallback when available.

## Callback Events

- `self_host_ready`
- `self_host_failed`
- `app_deploy_started`
- `app_deployed`
- `app_deploy_failed`

# Error And Retry Policy

1. `401/403`: local auth likely stale; prompt re-auth and replace stored credentials.
2. `404`: likely wrong `api_url` or resource id; confirm base URL/id.
3. `409`: treat as already-exists/in-progress; continue idempotently.
4. `422`: show concise input fix (missing/invalid field).
5. `429/5xx` or network timeout: retry with capped exponential backoff, then show next step.

# Response Style

1. Keep responses short and actionable.
2. Prefer clickable markdown labels over raw long links.
3. Ask for one-time OAuth code only when needed.
4. Confirm state transitions explicitly: `authenticated`, `machine ready`, `deploy started`, `deploy complete`.
