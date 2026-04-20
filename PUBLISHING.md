# Publishing Guide

## 1) Create Public GitHub Repo

Create a new public repository, for example:

- `clikdeploy-deploy-skill`

## 2) Sync Bundled CLI (Required)

Keep the bundled CLI tarball in this repo aligned with the latest CLI release:

```bash
cp /home/justin-gracier/Desktop/clikdeploy/apps/cli/clikdeploy-cli-1.0.4.tgz vendor/cli/
rm -f vendor/cli/clikdeploy-cli-1.0.3.tgz
```

Also update these references when CLI version changes:

- `setup.mjs` (`BUNDLED_CLI_TARBALL`)
- `README.md` bundled tarball filename

## 3) Push This Folder As Repo Root

From this folder:

```bash
cd /home/justin-gracier/Desktop/ClikDeploy-Agent-Skill
git add .
git commit -m "Initial public release: ClikDeploy deploy skill"
git push origin main
```

## 4) Tag a Release

```bash
git tag v0.6.0
git push origin v0.6.0
```

## 5) Share Install Instructions

Share your repo URL and usage from `README.md`.
