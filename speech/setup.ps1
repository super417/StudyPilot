$ErrorActionPreference = 'Stop'
$taskSpeechRoot = $PSScriptRoot
New-Item -ItemType Directory -Force -Path "$taskSpeechRoot/.cache/tmp", "$taskSpeechRoot/.cache/pip" | Out-Null
$env:TEMP = "$taskSpeechRoot/.cache/tmp"
$env:TMP = $env:TEMP
$env:PIP_CACHE_DIR = "$taskSpeechRoot/.cache/pip"
$taskPython = "$taskSpeechRoot/.venv-edge/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $taskPython)) {
    & "$taskSpeechRoot/../backend/.venv/Scripts/python.exe" -m venv "$taskSpeechRoot/.venv-edge"
    if ($LASTEXITCODE -ne 0) { throw 'Could not create project speech environment' }
}
& $taskPython -m pip install --index-url https://pypi.org/simple -r "$taskSpeechRoot/requirements.txt"
if ($LASTEXITCODE -ne 0) { throw 'Speech dependency installation failed' }
Write-Output 'Lightweight voice client installed in the project. No model download is needed.'
