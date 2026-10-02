@echo off
REM StudyPilot backend test runner (pytest + Hypothesis property tests)
title StudyPilot Backend Tests
pushd "%~dp0"
if errorlevel 1 ( echo [ERR] cannot enter backend directory ^& pause ^& exit /b 1 )
if not exist ".venv\Scripts\python.exe" (
  echo [ERR] backend virtual environment not found
  echo [INFO] create it with: py -3.13 -m venv .venv
  echo [INFO] then install deps: .venv\Scripts\python.exe -m pip install -r requirements.txt
  popd
  pause
  exit /b 1
)
echo [INFO] running backend test suite ...
echo [INFO] (includes Hypothesis property tests, >=100 iterations per property)
call ".venv\Scripts\python.exe" -m pytest tests -q
set TEST_EXIT=%errorlevel%
echo.
if "%TEST_EXIT%"=="0" (
  echo [OK] all backend tests passed
) else (
  echo [ERR] backend tests failed ^(exit code %TEST_EXIT%^)
)
popd
pause
exit /b %TEST_EXIT%
