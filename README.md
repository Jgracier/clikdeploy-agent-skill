# ClikDeploy Hermes Deploy Skill

A Hermes skill that keeps user experience simple:

1. User signs up/authenticates.
2. For OAuth, user completes consent and pastes a one-time code in chat.
3. Machine is connected automatically for deployments.
4. Hermes deploys open-source apps and returns the URL.

After auth completes, the user API key is saved locally to `~/.clikdeploy/api-key` for future deploy calls.

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
- One-time code paste step after OAuth

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
node scripts/hermes-chat-flow.mjs --mode start

# Email signup/login + auto-connect
node scripts/hermes-chat-flow.mjs --mode email-signup --email you@example.com --password 'secret'
node scripts/hermes-chat-flow.mjs --mode email-login --email you@example.com --password 'secret'

# OAuth link (user-facing)
node scripts/hermes-chat-flow.mjs --mode oauth-link --provider google

# OAuth completion (preferred: one-time code from callback page)
node scripts/hermes-chat-flow.mjs --mode oauth-complete --one-time-code <CODE>

# Deploy via deterministic Docker Hub selection
node scripts/deploy-dockerhub.mjs --query n8n --callback-url https://hermes.local/callback --request-id req_456

# Optional explicit key override:
node scripts/deploy-dockerhub.mjs --api-key <cd_live_key> --query n8n
```

`--api-url` remains available when targeting non-default environments.

## Publish

See `PUBLISHING.md`.

## License

MIT
