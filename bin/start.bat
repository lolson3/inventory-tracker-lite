@echo off
setlocal
cd /d "%~dp0\.." || exit /b 1
where node >nul 2>&1 || (
  echo ERROR: Install Node.js 24.15 or newer within the 24.x release line.
  exit /b 1
)
node -e "const [major, minor] = process.versions.node.split('.').map(Number); if (major !== 24 || minor < 15) { console.error('ERROR: Node.js 24.15+ (24.x) is required.'); process.exit(1); }"
if errorlevel 1 exit /b 1
if not exist "dist\server\server.js" goto needs_build
if not exist "dist\client\app.js" goto needs_build
node dist\server\server.js
exit /b %errorlevel%
:needs_build
echo ERROR: Build the application first with npm ci and npm run build.
exit /b 1
