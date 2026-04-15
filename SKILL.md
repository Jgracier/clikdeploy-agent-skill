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
- `node router.mjs auth-init google` # must return url to user for them to get 1 time generated code.
- `node router.mjs auth-init github` # must return url to user for them to get 1 time generated code.
- `node router.mjs auth-exchange <ONE_TIME_CODE> [google|github]` # User submits 1 time generated code for secure api key exchange (you never see it)

(auto-connects/updates self host after successful auth)
- `node router.mjs connect [SelfHost]`
- `node router.mjs deploy <app_name>`
- `node router.mjs list-apps`
- `node router.mjs list-servers`
- `node router.mjs delete-app <id>`
- `node router.mjs delete-server <id>`

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
