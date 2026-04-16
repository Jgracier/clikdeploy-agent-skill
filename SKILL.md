---
name: clikdeploy_deploy_skill
description: Simple contract for auth, connect, and deploy with ClikDeploy CLI.
version: 0.6.0
author: ClikDeploy
---

# Use These Commands

## Auth
- `clikdeploy whoami` # Check current auth status
- `clikdeploy login --google --return-url` # Login with Google and wait for 1 time code
- `clikdeploy login --github --return-url` # Login with GitHub and wait for 1 time code
- `clikdeploy login --exchange <ONE_TIME_CODE>` # User will return a 1 time code to exchange for locally stored api key and self host connection.

## Structured Discovery
- `clikdeploy deploy` # no arg will return structured JSON of deployable apps from connected servers
- `clikdeploy status` # no arg will return structured JSON of status of apps from connected servers
- `clikdeploy list` # no arg will return structured JSON of connected servers and their apps
- `clikdeploy connect` # no arg, will return structured JSON of available server connection options, this skill is for the self host option.

## Deploy
- `clikdeploy deploy <app-name>` # Name only will resolve with dockerhub and deploy automatically. App will deploy to a single connected server immediately or will return list of servers if more than 1 to clarify which server to deploy to.


## Operate
- `clikdeploy status <app-or-server>`
- `clikdeploy logs <app>`
- `clikdeploy restart <app>`
- `clikdeploy stop <app>`
- `clikdeploy start <app>`
- `clikdeploy delete <app-or-server>`

# Rule

If a command cannot run without clarification use the structured JSON clarification response and follow the provided format to ask the user for more information.
