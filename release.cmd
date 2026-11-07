@echo off
setlocal
cd /d "%~dp0"
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo Node.js 22+ is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\esbuild\package.json" (
  call npm.cmd ci
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)
call npm.cmd run release
set "release_exit=%errorlevel%"
if not "%release_exit%"=="0" echo Release build failed. Do not publish incomplete output.
pause
exit /b %release_exit%
