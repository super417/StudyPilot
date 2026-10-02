@echo off
REM StudyPilot frontend one-click start
title StudyPilot Frontend
pushd "%~dp0"
if errorlevel 1 ( echo [ERR] cannot enter frontend directory ^& pause ^& exit /b 1 )
where node >nul 2>nul
if errorlevel 1 ( echo [ERR] Node.js not found - install Node.js first ^& popd ^& pause ^& exit /b 1 )
if not exist "node_modules" (
  echo [INFO] installing dependencies, please wait ...
  call npm install
  if errorlevel 1 ( echo [ERR] npm install failed ^& popd ^& pause ^& exit /b 1 )
)
echo [INFO] cleaning up any process using port 5173 ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\stop-port.ps1" -Port 5173
timeout /t 1 /nobreak >nul
start "" powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 6; Start-Process 'http://127.0.0.1:5173/'"
echo [INFO] starting Vite at http://127.0.0.1:5173/
echo [INFO] browser opens in about 6 seconds; if blank, wait then refresh
call npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
echo.
echo [INFO] frontend server stopped
popd
pause
