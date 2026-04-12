# Publishing Guide

## 1) Create Public GitHub Repo

Create a new public repository, for example:

- `clikdeploy-hermes-deploy-skill`

## 2) Push This Folder As Repo Root

From this folder:

```bash
cd apps/hermes-skill
git init
git add .
git commit -m "Initial public release: ClikDeploy Hermes deploy skill"
git branch -M main
git remote add origin git@github.com:<owner>/clikdeploy-hermes-deploy-skill.git
git push -u origin main
```

## 3) Tag a Release

```bash
git tag v0.2.0
git push origin v0.2.0
```

## 4) Share Install Instructions

Share your repo URL and usage from `README.md`.

If using Hermes skill hub/taps, publish/index according to your Hermes deployment workflow.
