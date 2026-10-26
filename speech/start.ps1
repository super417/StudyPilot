$ErrorActionPreference = 'Stop'
$taskPython = "$PSScriptRoot/.venv/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Run speech/setup.ps1 first' }
& $taskPython "$PSScriptRoot/worker.py"
exit $LASTEXITCODE
