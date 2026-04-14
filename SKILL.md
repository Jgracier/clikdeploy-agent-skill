---
name: clikdeploy_deploy_skill
description: Guide authentication, prepare this machine for app deployment, and provide deployment access.
version: 0.2.0
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

1. User signs up/authenticates.
2. If OAuth is used, user pastes a one-time code from browser into this session.
3. Deploy capability is connected automatically.
4. Agent deploys apps on request.
5. Persist local credentials so deploy commands do not require re-auth each time.

# Script Interface (Use These)

## 1) Start auth flow

```bash
node scripts/agent-flow.mjs --mode start [--api-url <api_url>]
```

## 2) Email auth

```bash
node scripts/agent-flow.mjs --mode email-signup --email <email> --password <password> [--api-url <api_url>] [--name <machine_name>] [--callback-url <url>] [--request-id <id>]
node scripts/agent-flow.mjs --mode email-login --email <email> --password <password> [--api-url <api_url>] [--callback-url <url>] [--request-id <id>]
```

## 3) OAuth path

```bash
node scripts/agent-flow.mjs --mode oauth-link --provider google [--api-url <api_url>]
node scripts/agent-flow.mjs --mode oauth-link --provider github [--api-url <api_url>]
```

After OAuth in browser, user pastes the one-time code into this session.

OAuth completion:

```bash
node scripts/agent-flow.mjs --mode oauth-complete --one-time-code <code> [--api-url <api_url>] [--callback-url <url>] [--request-id <id>]
```

Connect:

```bash
node scripts/agent-flow.mjs --mode connect [--api-url <api_url>] [--name <machine_name>] [--callback-url <url>] [--request-id <id>]
```

Reconnect:

```bash
node scripts/agent-flow.mjs --mode reconnect [--api-url <api_url>] [--name <machine_name>] [--callback-url <url>] [--request-id <id>]
```

Auth status check:

```bash
node scripts/agent-flow.mjs --mode auth-status [--api-url <api_url>]
```

Logout (clear local authentication):

```bash
node scripts/agent-flow.mjs --mode logout
```

## 4) Deploy app (minimal input)

```bash
node scripts/deploy-dockerhub.mjs --image <repo[:tag]> [--api-url <api_url>] [--callback-url <url>] [--request-id <id>]
```

Image name is the only required deploy input.

Optional lookup mode:

```bash
node scripts/deploy-dockerhub.mjs --query <app_query> [--api-url <api_url>] [--callback-url <url>] [--request-id <id>]
```

Optional explicit key override:

```bash
node scripts/deploy-dockerhub.mjs --api-key <api_key> --image <repo[:tag]> [--api-url <api_url>]
```

Port is assigned automatically.

Optional wait controls:

```bash
node scripts/deploy-dockerhub.mjs --image <repo[:tag]> --no-wait
node scripts/deploy-dockerhub.mjs --image <repo[:tag]> --wait
node scripts/deploy-dockerhub.mjs --image <repo[:tag]> --wait-timeout-ms <ms>
```

# Callback Events

Webhook callback event is built in.

- `self_host_ready`
- `self_host_failed`
- `app_deployed`
- `app_deploy_failed`

Deploy completion behavior:

- With callback URL present, deploy is callback-driven by default (non-blocking).
- Use `--wait` only when explicit terminal blocking behavior is required.

# Output Preference

- Prefer short labeled clickable links over raw long URLs when available.
