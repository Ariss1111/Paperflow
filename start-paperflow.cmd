@echo off
rem Starts Paperflow on http://localhost:3210 using the portable Node.js in .tools\node.
rem First run: builds the app (takes about a minute). Close this window to stop the server.
cd /d "%~dp0"
set "PATH=%~dp0.tools\node;%PATH%"
if not exist ".tools\node\node.exe" (
  echo Portable Node.js not found in .tools\node. Install Node.js 22 LTS from https://nodejs.org and run: npm install
  pause
  exit /b 1
)
if not exist "node_modules" call npm install
if not exist ".next\BUILD_ID" call npm run build
echo.
echo   Paperflow is starting at http://localhost:3210
echo.
start "" http://localhost:3210
node node_modules\next\dist\bin\next start -p 3210
