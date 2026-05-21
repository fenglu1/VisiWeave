# Startup Guide

This document records the quickest reliable way to start `gpt-image-canvas` on this machine.

It includes:

- the normal repo startup path
- the Windows fallback path that has already been verified to work here
- common failure cases and the exact fix
- notes from the latest startup debugging session on this machine

## Expected Environment

- Node.js: `24.15.0`
- pnpm: `9.14.2`
- Shell: Windows PowerShell
- Repo root: `D:\qingsong\code\gpt-image-canvas-main`

The repo pins Node in:

- `.node-version`
- `.nvmrc`

## First-Time Setup

From the repo root:

```powershell
pnpm install
Copy-Item .env.example .env
```

If `pnpm` is not in PATH but `corepack` is available:

```powershell
corepack prepare pnpm@9.14.2 --activate
```

## Normal Startup

If your shell already uses:

- `Node 24.15.0`
- `pnpm 9.14.2`

then run:

```powershell
pnpm dev
```

Expected URLs:

- Web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787`

## Verified Windows Fallback

On this machine, `pnpm dev` may fail because child processes cannot find `pnpm` from PATH.

When that happens, use the already-verified startup path below.

### 1. Start API

Open a PowerShell window in the repo root and run:

```powershell
$env:PATH='D:\app\nvm\nvm\v24.15.0;' + $env:PATH
D:\app\nvm\nvm\v24.15.0\corepack.cmd pnpm --filter @gpt-image-canvas/api dev
```

Successful startup will print:

```text
API listening at http://127.0.0.1:8787
```

### 2. Start Web

Open a second PowerShell window and run from `apps/web`, or explicitly set the working directory to `apps/web` before running Vite:

```powershell
D:\app\nvm\nvm\v24.15.0\node.exe D:\qingsong\code\gpt-image-canvas-main\node_modules\.pnpm\vite@8.0.10_@types+node@24.12.2_esbuild@0.27.7_jiti@1.21.7_tsx@4.21.0_yaml@2.8.3\node_modules\vite\bin\vite.js --host 127.0.0.1
```

Successful startup will print something like:

```text
VITE v8.0.10 ready
Local: http://127.0.0.1:5173/
```

Important:

- the Vite command must run with working directory `D:\qingsong\code\gpt-image-canvas-main\apps\web`
- if you launch the same command from the repo root, Vite may still start and `/@vite/client` may return `200`, but `/` can return `404`
- that failure mode makes the browser look like "the app did not open", even though a Vite process is alive

### 3. Open the App

Use:

```text
http://127.0.0.1:5173
```

## Health Checks

Quick checks after startup:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/health
```

Expected API health response:

```json
{"status":"ok"}
```

Expected web response:

- `http://127.0.0.1:5173/` should return `200`
- the response body should begin with HTML such as `<!doctype html>`
- `200` from `http://127.0.0.1:5173/@vite/client` alone is not enough to prove the app is correctly mounted

Useful checks:

```powershell
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173).StatusCode
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173).Content.Substring(0, 50)
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/health).Content
```

## Common Problems

### `pnpm dev` fails because `pnpm` is not recognized

Cause:

- the root script launches workspace child processes
- those child processes do not inherit a working `pnpm` PATH

Fix:

- use the `Verified Windows Fallback` commands above

### Vite says Node is too old

Cause:

- current shell is using Node `20.x` or `18.x`

Fix:

Use the pinned Node directly:

```powershell
D:\app\nvm\nvm\v24.15.0\node.exe -v
```

or switch through `nvm` before starting.

### Port `5173` already in use

Fix:

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen
Stop-Process -Id <PID> -Force
```

Then restart Web.

### Port `8787` already in use

Fix:

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen
Stop-Process -Id <PID> -Force
```

Then restart API.

### Browser shows Vite is running but the app page is blank or `404`

Cause:

- Web was started from the wrong working directory
- in this repo, that usually means Vite was launched from the repo root instead of `apps/web`

Symptoms:

- terminal says Vite is ready on `http://127.0.0.1:5173/`
- `http://127.0.0.1:5173/@vite/client` returns `200`
- `http://127.0.0.1:5173/` or `/gallery` returns `404`

Fix:

1. Find the process using port `5173`
2. Stop it
3. Restart Web from working directory `apps/web`

Commands:

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen
Stop-Process -Id <PID> -Force
```

Then start Web again from `D:\qingsong\code\gpt-image-canvas-main\apps\web`.

### Gallery or provider config looks empty, but local data should exist

Cause:

- API is not running, or the frontend cannot currently reach it
- this can look like "my config and data disappeared" even when SQLite data is still present

What was verified during the latest startup session:

- local data still existed in `data/gpt-image-canvas.sqlite`
- `provider_configs`, `projects`, `assets`, and `generation_records` were still populated
- once API was restarted, `/api/provider-config` and `/api/gallery` returned the expected saved state

Quick checks:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/provider-config
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/gallery
```

If needed, inspect the local database counts directly:

```powershell
$db='D:\qingsong\code\gpt-image-canvas-main\data\gpt-image-canvas.sqlite'
D:\app\nvm\nvm\v24.15.0\node.exe -e "const Database=require('D:/qingsong/code/gpt-image-canvas-main/node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3'); const db=new Database(process.argv[1], { readonly: true }); for (const t of ['projects','assets','provider_configs','storage_configs','agent_llm_configs','generation_records']) { console.log(t + ':' + db.prepare('SELECT COUNT(*) as count FROM ' + t).get().count); }" "$db"
```

If the database still has rows, restart API first before assuming data loss.

### `better-sqlite3` version mismatch after switching Node

Fix:

```powershell
pnpm --filter @gpt-image-canvas/api rebuild better-sqlite3 --stream
```

## Where Runtime Files Go

Local runtime data is stored under:

```text
data/
```

Important folders:

- `data/assets` for original generated or imported assets
- `data/asset-previews` for generated previews
- `data/gpt-image-canvas.sqlite` for local app state

## Recommended Routine

If startup is flaky on Windows, use this exact routine:

1. Open terminal A in repo root
2. Run the API fallback command
3. Open terminal B
4. `cd apps/web`
5. Run the Web fallback command
6. Confirm both:
   - `http://127.0.0.1:8787/api/health` returns `{"status":"ok"}`
   - `http://127.0.0.1:5173/` returns HTML, not `404`
7. Visit `http://127.0.0.1:5173`

That is the path that has been verified to work for this repository on this machine.
