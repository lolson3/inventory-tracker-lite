@echo off
setlocal

rem Always run from the project directory, including under Task Scheduler.
cd /d "%~dp0" || exit /b 1

where node >nul 2>&1 || (
  echo ERROR: Node.js is not installed or is not available in PATH.
  exit /b 1
)

where npm >nul 2>&1 || (
  echo ERROR: npm is not installed or is not available in PATH.
  exit /b 1
)

set "INSTALL_DEPS=false"
if not exist "node_modules\.package-lock.json" set "INSTALL_DEPS=true"
if not exist "node_modules\typescript\bin\tsc" set "INSTALL_DEPS=true"
if exist "node_modules\.package-lock.json" (
  powershell -NoProfile -Command "if ((Get-Item -LiteralPath 'package-lock.json').LastWriteTimeUtc -gt (Get-Item -LiteralPath 'node_modules\.package-lock.json').LastWriteTimeUtc) { exit 0 } else { exit 1 }"
  if not errorlevel 1 set "INSTALL_DEPS=true"
)

if "%INSTALL_DEPS%"=="true" (
  echo Installing inventory tracker dependencies...
  call npm ci --include=dev
  if errorlevel 1 exit /b 1
)

echo Building Inventory Tracker Lite...
call npm run build
if errorlevel 1 exit /b 1

echo Starting Inventory Tracker Lite...
call npm start
exit /b %errorlevel%
