# Windows shortcut

A script that starts ComfyUI and HEISS UI if they aren't running, then opens the browser. It starts HEISS UI through `scripts/start.mjs` like the launcher does, so in-app updates keep working.

```powershell
$appRoot = "C:\path\to\heiss-ui"
$comfyRoot = "C:\path\to\ComfyUI"
$python = "C:\path\to\python.exe"

if (-not (Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process $python "main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch" -WorkingDirectory $comfyRoot -WindowStyle Hidden
}

if (-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process node "scripts/start.mjs" -WorkingDirectory $appRoot -WindowStyle Hidden
}

Start-Process "http://localhost:8787/"
```
