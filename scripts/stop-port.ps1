param(
    [int]$Port = 5173
)

$connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)

if ($connections.Count -eq 0) {
    Write-Output "[INFO] port $Port is already free"
    exit 0
}

$processIds = $connections | ForEach-Object { $_.OwningProcess } | Select-Object -Unique
foreach ($processId in $processIds) {
    try {
        Stop-Process -Id $processId -Force -ErrorAction Stop
        Write-Output "[INFO] stopped process $processId using port $Port"
    }
    catch {
        [Console]::Error.WriteLine("[WARN] could not stop process $processId using port $Port")
    }
}

exit 0
