@echo off
REM StudyPilot start script
title StudyPilot
pushd "%~dp0frontend"
if errorlevel 1 ( echo [ERR] cannot enter directory ^& pause ^& exit /b 1 )
where node >nul 2>nul
if errorlevel 1 ( echo [ERR] Node.js not found - install Node.js first ^& popd ^& pause ^& exit /b 1 )
if not exist "node_modules" (
  echo [INFO] installing dependencies, please wait ...
  call npm install
  if errorlevel 1 ( echo [ERR] npm install failed ^& popd ^& pause ^& exit /b 1 )
)
echo [INFO] cleaning up any process using port 5173 ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-port.ps1" -Port 5173
timeout /t 1 /nobreak >nul
start "" powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 6; Start-Process 'http://127.0.0.1:5173/'"
echo [INFO] starting server, browser opens in about 6 seconds
echo [INFO] if page is blank, wait a moment then refresh
call npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
echo.
echo [INFO] server stopped
popd
pause
