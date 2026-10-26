$ErrorActionPreference = 'Stop'
$taskSpeechRoot = $PSScriptRoot
New-Item -ItemType Directory -Force -Path "$taskSpeechRoot/.cache/tmp", "$taskSpeechRoot/.cache/pip" | Out-Null
$env:TEMP = "$taskSpeechRoot/.cache/tmp"
$env:TMP = $env:TEMP
$env:PIP_CACHE_DIR = "$taskSpeechRoot/.cache/pip"
$taskPython = "$taskSpeechRoot/.venv/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $taskPython)) {
    & "$taskSpeechRoot/../backend/.venv/Scripts/python.exe" -m venv "$taskSpeechRoot/.venv"
    if ($LASTEXITCODE -ne 0) { throw 'Could not create project speech environment' }
}
& $taskPython -m pip install --index-url https://download.pytorch.org/whl/cu121 torch==2.5.1 torchaudio==2.5.1
if ($LASTEXITCODE -ne 0) { throw 'CUDA runtime installation failed' }
& $taskPython -m pip install -r "$taskSpeechRoot/requirements.txt"
if ($LASTEXITCODE -ne 0) { throw 'Speech dependency installation failed' }
& $taskPython "$taskSpeechRoot/download_model.py"
if ($LASTEXITCODE -ne 0) { throw 'Model download failed' }
Write-Output 'Serena ready. Run speech/start.ps1 to start the local voice service.'
