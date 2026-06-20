---
name: infinite-canvas-deploy
description: Deploy, operate, or troubleshoot this fork of basketikun/infinite-canvas on the v2api production server. Use when Codex needs to deploy image.v2api.top, update the Next.js standalone service, manage the infinite-canvas systemd service, check Nginx/certbot configuration, verify port 3100, or diagnose production issues for the Infinite Canvas image workspace.
---

# Infinite Canvas Deploy

## Production Facts

- Project root: `F:\selfProject\infinite-canvas`
- Production host: `104.160.47.89`
- SSH user: `root`
- SSH key: `C:\Users\PC-20251213\.ssh\new_api_deploy_rsa`
- Public domain: `https://image.v2api.top`
- App service: `infinite-canvas.service`
- App port: `3100`
- App path: `/opt/infinite-canvas`
- Current symlink: `/opt/infinite-canvas/current`
- Node runtime: `/opt/node-v22/bin/node`
- Nginx config: `/etc/nginx/conf.d/image.v2api.top.conf`
- TLS cert: `/etc/letsencrypt/live/image.v2api.top/fullchain.pem`
- Do not touch NewApi service `new-api-native` or port `3000` unless the user explicitly asks.

## Local Commands

Run frontend commands from `web/`.

```powershell
npm run build
```

Use `bun` when dependency download works. If Bun tarball downloads fail on this Windows host, `npm install --package-lock=false --legacy-peer-deps` has been used successfully without creating `package-lock.json`.

Remote upload/command helper:

```powershell
& 'C:\Program Files (x86)\Go\bin\go.exe' run . `
  -key-path C:\Users\PC-20251213\.ssh\new_api_deploy_rsa `
  -command "systemctl status infinite-canvas.service --no-pager"
```

Run that helper from `scripts/remote-upload-exec`.

## Deploy Workflow

1. Build locally:

```powershell
cd F:\selfProject\infinite-canvas\web
npm run build
```

2. Package the standalone output from the repo root:

```powershell
$ErrorActionPreference='Stop'
$sha = (git rev-parse --short=12 HEAD).Trim()
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$stage = Join-Path (Get-Location) ".deploy\infinite-canvas-$stamp-$sha"
$archive = Join-Path (Get-Location) ".deploy\infinite-canvas-$stamp-$sha.tar.gz"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$stage\web" | Out-Null
Copy-Item VERSION "$stage\VERSION"
Copy-Item CHANGELOG.md "$stage\CHANGELOG.md"
Copy-Item web\.next\standalone\* "$stage\web" -Recurse -Force
New-Item -ItemType Directory -Force -Path "$stage\web\.next\static" | Out-Null
Copy-Item web\.next\static\* "$stage\web\.next\static" -Recurse -Force
Copy-Item web\public "$stage\web\public" -Recurse -Force
if (Test-Path $archive) { Remove-Item -Force $archive }
tar.exe -czf $archive -C (Split-Path $stage -Parent) (Split-Path $stage -Leaf)
```

3. Upload and switch release with `scripts/remote-upload-exec`.

Use a release directory named exactly like the archive stem. Set `/opt/infinite-canvas/current` to the new release, then restart `infinite-canvas.service`.

4. Verify:

```powershell
curl.exe -I --max-time 20 http://104.160.47.89:3100/
```

Server-side checks:

```bash
systemctl is-active infinite-canvas.service
ss -ltnp | grep ':3100 '
curl -fsSI --resolve image.v2api.top:443:104.160.47.89 https://image.v2api.top/
```

## Nginx And TLS

`image.v2api.top` must proxy to `127.0.0.1:3100`. Keep its config separate from `/etc/nginx/conf.d/v2api.top.conf`.

After editing Nginx:

```bash
nginx -t
systemctl reload nginx
```

Certificate was issued with:

```bash
certbot certonly --webroot -w /var/www/acme-challenge -d image.v2api.top --non-interactive --agree-tos --cert-name image.v2api.top
```

If local Windows `curl.exe` reports TLS handshake failures against this server, verify from the server with `curl --resolve`; this has happened even for the existing `v2api.top` domain and is not by itself proof that Nginx is broken.

## Rollback

List releases:

```bash
ls -lt /opt/infinite-canvas/releases
```

Switch back:

```bash
ln -sfn /opt/infinite-canvas/releases/<release-name> /opt/infinite-canvas/current
systemctl restart infinite-canvas.service
curl -fsSI http://127.0.0.1:3100/
```
