---
name: clikdeploy_Hermes_deploy_skill
description: Sign up, connect this machine automatically, then deploy apps and return the URL.
version: 0.2.0
author: ClikDeploy
license: MIT
platforms:
  - linux
  - macos
  - windows
metadata:
  hermes:
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

Hermes should operate with this simple model:

1. User signs up/authenticates.
2. Deploy capability is connected automatically.
3. Hermes can deploy apps on user request.

Hermes should keep this simple for users: sign up, confirm machine is ready, then deploy apps on request.

# What Hermes Should Say

When unauthenticated:

- Offer:
  - "Sign up to deploy apps to this machine."
  - Email/password signup/login
  - [Sign up with Google](...) 
  - [Sign up with GitHub](...)

After auth completes:

- Confirm readiness: machine is ready to deploy apps.
- Offer suggested apps users find helpful.

After deploy:

- Confirm app is up.
- Provide URL.

# Script Interface (Use These)

## 1) Start auth flow (chat-safe options)

```bash
node scripts/hermes-chat-flow.mjs --mode start --api-url <api_url>
```

## 2) Email path (auto-connect happens in flow)

```bash
node scripts/hermes-chat-flow.mjs --mode email-signup --api-url <api_url> --email <email> --password <password> [--name <machine_name>] [--callback-url <url>] [--request-id <id>]
node scripts/hermes-chat-flow.mjs --mode email-login --api-url <api_url> --email <email> --password <password> [--callback-url <url>] [--request-id <id>]
```

## 3) OAuth path

```bash
node scripts/hermes-chat-flow.mjs --mode oauth-link --provider google --api-url <api_url>
node scripts/hermes-chat-flow.mjs --mode oauth-link --provider github --api-url <api_url>
```

When OAuth completes and API key is available:

```bash
node scripts/hermes-chat-flow.mjs --mode oauth-complete --api-url <api_url> --api-key <api_key> [--callback-url <url>] [--request-id <id>]
```

## 4) Deploy app (deterministic)

```bash
node scripts/deploy-dockerhub.mjs --api-url <api_url> --api-key <api_key> --query <app_query> --wait [--callback-url <url>] [--request-id <id>]
```

or direct image:

```bash
node scripts/deploy-dockerhub.mjs --api-url <api_url> --api-key <api_key> --image <repo[:tag]> --wait [--callback-url <url>] [--request-id <id>]
```

# Callback Events (If callback URL is provided)

- `self_host_ready`
- `self_host_failed`
- `app_deployed`
- `app_deploy_failed`

# Response Style

- Keep messages short and actionable.
- Prefer clickable markdown labels over raw long links.
- Never print API keys back to the user.
