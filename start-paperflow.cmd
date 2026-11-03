@echo off
rem Starts Pagelyt on http://localhost:3210 using the portable Node.js in .tools\node.
rem First run: builds the app (takes about a minute). Close this window to stop the server.
cd /d "%~dp0"
set "PATH=%~dp0.tools\node;%PATH%"
if not exist ".tools\node\node.exe" (
  echo Portable Node.js not found in .tools\node. Install Node.js 22 LTS from https://nodejs.org and run: npm install
  pause
  exit /b 1
)
rem Accounts on this computer: data stays in .data, emails go to the dev inbox at /dev/mail, and a
rem signing key is generated once. A public deployment sets AUTH_SECRET and SMTP instead (see DEPLOY.md).
if not defined DATA_DIR set "DATA_DIR=%~dp0.data"
if not defined DEV_MAILBOX set "DEV_MAILBOX=1"
if not defined ALLOW_GENERATED_SECRET set "ALLOW_GENERATED_SECRET=1"
if not exist "node_modules" call npm install
if not exist ".next\BUILD_ID" call npm run build
echo.
echo   Pagelyt is starting at http://localhost:3210
echo.
start "" http://localhost:3210
node node_modules\next\dist\bin\next start -p 3210
