# ClikDeploy Hermes Deploy Skill

A Hermes skill that keeps user experience simple:

1. User signs up/authenticates.
2. Machine is connected automatically for deployments.
3. Hermes deploys open-source apps and returns the URL.

## What This Repo Includes

- `SKILL.md`: Hermes skill contract (minimal agent-facing behavior)
- `scripts/hermes-chat-flow.mjs`: auth orchestration + auto-connect trigger
- `scripts/auto-onboard.mjs`: direct onboarding wrapper
- `scripts/deploy-dockerhub.mjs`: deterministic Docker Hub search/rank/deploy + callback
- `scripts/auth-options.mjs`: signup options output
- `examples/callback-events.json`: callback payload examples

## Signup Options Shown In Chat

- Email + password
- Sign up with Google
- Sign up with GitHub

Messaging is friendly and short:

- "Sign up to deploy apps to this machine"

## Auto Connect

- Auto-connect after auth completion
- Docker image selection when using query mode:
  - highest pull count
  - then highest stars
  - then trusted/official flags
- Callback events for readiness and deployment outcomes

## Callback Events

- `self_host_ready`
- `self_host_failed`
- `app_deployed`
- `app_deploy_failed`

See `examples/callback-events.json` for payload shapes.

## Local Usage

```bash
# Start chat-safe auth options
node scripts/hermes-chat-flow.mjs --mode start --api-url https://clikdeploy.com

# Email signup/login + auto-connect
node scripts/hermes-chat-flow.mjs --mode email-signup --api-url https://clikdeploy.com --email you@example.com --password 'secret'
node scripts/hermes-chat-flow.mjs --mode email-login --api-url https://clikdeploy.com --email you@example.com --password 'secret'

# OAuth link + completion hook
node scripts/hermes-chat-flow.mjs --mode oauth-link --provider google --api-url https://clikdeploy.com
node scripts/hermes-chat-flow.mjs --mode oauth-complete --api-url https://clikdeploy.com --api-key <cd_live_key>

# Deploy via deterministic Docker Hub selection
node scripts/deploy-dockerhub.mjs --api-url https://clikdeploy.com --api-key <cd_live_key> --query n8n --wait --callback-url https://hermes.local/callback --request-id req_456
```

## Install For Hermes Users

Common pattern:

1. Clone this repo.
2. Copy `SKILL.md` (and scripts folder if your setup executes local scripts) into your Hermes skills location, or publish via Hermes skills publishing workflow.
3. Register/use the skill in Hermes.

## Publish

See `PUBLISHING.md`.

## License

MIT
