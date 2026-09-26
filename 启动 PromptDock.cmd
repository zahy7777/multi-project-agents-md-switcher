@echo off
setlocal
cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 goto missing_pnpm

call pnpm build
if errorlevel 1 goto build_failed

set "PROMPTDOCK_OPEN_BROWSER=1"
call pnpm start
set "exit_code=%ERRORLEVEL%"
if not "%exit_code%"=="0" (
  echo PromptDock exited with code %exit_code%.
  pause
)
exit /b %exit_code%

:missing_pnpm
echo pnpm was not found. Install Node.js and pnpm first.
pause
exit /b 1

:build_failed
echo PromptDock build failed. Read the error above.
pause
exit /b 1
