# ClikDeploy Deploy Skill

An agent skill that keeps user experience simple:

1. User signs up/authenticates.
2. For OAuth, user completes consent and pastes a one-time code in chat.
3. Machine is connected automatically for deployments.
4. The agent deploys open-source apps and returns the URL.

After auth completes, the user API key is saved locally to `~/.clikdeploy/api-key` for future deploy calls.

## What This Repo Includes

- `SKILL.md`: skill contract (minimal agent-facing behavior)
- `scripts/agent-flow.mjs`: auth orchestration + auto-connect trigger
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

Webhook callback event is built in.

- `self_host_ready`
- `self_host_failed`
- `app_deployed`
- `app_deploy_failed`

See `examples/callback-events.json` for payload shapes.

## Local Usage

```bash
# Start agent-safe auth options
node scripts/agent-flow.mjs --mode start

# Email signup/login + auto-connect
node scripts/agent-flow.mjs --mode email-signup --email you@example.com --password 'secret'
node scripts/agent-flow.mjs --mode email-login --email you@example.com --password 'secret'

# OAuth link (user-facing)
node scripts/agent-flow.mjs --mode oauth-link --provider google

# OAuth completion (preferred: one-time code from callback page)
node scripts/agent-flow.mjs --mode oauth-complete --one-time-code <CODE>

# Reconnect self-host on this machine (full reconnect flow)
node scripts/agent-flow.mjs --mode reconnect

# Check authentication status
node scripts/agent-flow.mjs --mode auth-status

# Log out (clear local authentication)
node scripts/agent-flow.mjs --mode logout

# Deploy by image name (only required deploy input)
node scripts/deploy-dockerhub.mjs --image n8nio/n8n

# Optional lookup mode (query -> auto-pick image):
node scripts/deploy-dockerhub.mjs --query n8n

# Optional callback webhook:
node scripts/deploy-dockerhub.mjs --image n8nio/n8n --callback-url https://agent.local/callback --request-id req_456
```

`--api-url` remains available when targeting non-default environments.

## Publish

See `PUBLISHING.md`.

## License

MIT
