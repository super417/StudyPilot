@echo off
REM StudyPilot backend start script
title StudyPilot Backend
pushd "%~dp0"
if errorlevel 1 ( echo [ERR] cannot enter backend directory ^& pause ^& exit /b 1 )
if not exist ".venv\Scripts\python.exe" (
  echo [ERR] backend virtual environment not found
  echo [INFO] create it with: py -3.13 -m venv .venv
  popd
  pause
  exit /b 1
)
if not exist ".env" (
  echo [ERR] backend .env not found
  echo [INFO] copy .env.example to .env and fill DATABASE_URL, DB_PASSWORD, AES_KEY
  popd
  pause
  exit /b 1
)
echo [INFO] applying database migrations ...
call ".venv\Scripts\python.exe" -m alembic upgrade head
if errorlevel 1 (
  echo [ERR] database migration failed
  popd
  pause
  exit /b 1
)
echo [INFO] starting StudyPilot API at http://127.0.0.1:8000/
echo [INFO] health check: http://127.0.0.1:8000/health
call ".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
echo.
echo [INFO] backend server stopped
popd
pause
