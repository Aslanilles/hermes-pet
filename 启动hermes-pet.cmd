@echo off
setlocal
rem hermes-pet launcher - ASCII only, idempotent, double-click to start.
rem Steps: check Node -> check Electron runtime (npm install if missing) -> start the pet.
cd /d "%~dp0"

echo [hermes-pet] working dir: %CD%

where node >nul 2>nul
if errorlevel 1 (
  echo [hermes-pet] ERROR: Node.js not found in PATH. Install Node 20 or newer first.
  pause
  exit /b 1
)

set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"

if not exist "node_modules\electron\dist\electron.exe" (
  echo [hermes-pet] Electron runtime missing, running npm install via npmmirror...
  call npm install --registry=https://npmmirror.com
  if errorlevel 1 (
    echo [hermes-pet] ERROR: npm install failed. Check network or proxy settings.
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [hermes-pet] ERROR: electron binary still missing after install.
  echo [hermes-pet] See .hermes-docker.md for the manual download fallback.
  pause
  exit /b 1
)

echo [hermes-pet] starting...
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
