@echo off
REM StudyPilot one-click launcher.
REM Opens two windows: backend (8000, auto-reload) and frontend (5173).
REM This file is intentionally ASCII-only: a non-ASCII byte in a .bat is read
REM with the console code page and comes out garbled. The project path is
REM never written literally, only via %~dp0.
setlocal
title StudyPilot Launcher

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"

REM ---------------- preflight ----------------
if not exist "%BACKEND%\.venv\Scripts\python.exe" (
  echo [ERR] backend virtual environment not found
  echo [INFO] create it with:  py -3.13 -m venv .venv    ^(run inside backend\^)
  pause
  exit /b 1
)
if not exist "%BACKEND%\.env" (
  echo [ERR] backend .env not found
  echo [INFO] copy backend\.env.example to backend\.env, fill DATABASE_URL / DB_PASSWORD / AES_KEY
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERR] Node.js not found - install Node.js first
  pause
  exit /b 1
)
if not exist "%FRONTEND%\node_modules" (
  echo [INFO] installing frontend dependencies, please wait ...
  pushd "%FRONTEND%"
  call npm install
  if errorlevel 1 ( echo [ERR] npm install failed & popd & pause & exit /b 1 )
  popd
)

REM ---------------- free the ports ----------------
REM A leftover process on either port keeps serving OLD code after you edit it,
REM which shows up as "the app hangs" rather than as an error. Clear both first.
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\stop-port.ps1" -Port 8000
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\stop-port.ps1" -Port 5173
timeout /t 1 /nobreak >nul

REM ---------------- launch ----------------
echo [INFO] starting backend on http://127.0.0.1:8000/ ...
REM --reload-dir app keeps the watcher off .venv (huge, and not source).
start "StudyPilot Backend" /D "%BACKEND%" cmd /k ".venv\Scripts\python.exe -m alembic upgrade head && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port 8000"

echo [INFO] starting frontend on http://127.0.0.1:5173/ ...
echo [INFO] browser opens in about 6 seconds
start "" powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 6; Start-Process 'http://127.0.0.1:5173/'"
start "StudyPilot Frontend" /D "%FRONTEND%" cmd /k "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"

echo [INFO] waiting for the backend health check ...
powershell -NoProfile -Command "for ($i=0; $i -lt 30; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:8000/health'; if ($r.StatusCode -eq 200) { Write-Output '[INFO] backend is up'; exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; Write-Output '[WARN] backend did not answer within 15s - read the StudyPilot Backend window'"

echo.
echo [INFO] windows opened: StudyPilot Backend / StudyPilot Frontend
echo [INFO] stop a service with Ctrl+C in its own window
timeout /t 6 /nobreak >nul
endlocal
