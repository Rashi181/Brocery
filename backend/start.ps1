param([int]$Port = 8002, [string]$Python = '')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$envDir = Join-Path $PSScriptRoot '.venv'
$runtime = Join-Path $envDir 'Scripts\python.exe'
if (!(Test-Path -LiteralPath $runtime)) {
    if ($Python) { & $Python -m venv $envDir }
    elseif (Get-Command py -ErrorAction SilentlyContinue) { & py -3 -m venv $envDir }
    elseif (Get-Command python -ErrorAction SilentlyContinue) { & python -m venv $envDir }
    else { throw 'Install Python 3.11+ or run .\start.ps1 -Python C:\path\to\python.exe' }
    if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed.' }
}
& $runtime -m pip --version *> $null
if ($LASTEXITCODE -ne 0) {
    & $runtime -m ensurepip --upgrade
    if ($LASTEXITCODE -ne 0) { throw 'pip bootstrap failed. Use a full Python installation (3.11+) and retry.' }
}
$requirements = Join-Path $PSScriptRoot 'requirements.txt'
$metaRequirements = Join-Path (Split-Path $PSScriptRoot) 'person2-intelligence\requirements.txt'
$fingerprint = (Get-FileHash -LiteralPath $requirements).Hash + (Get-FileHash -LiteralPath $metaRequirements).Hash + (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'constraints.txt')).Hash
$marker = Join-Path $envDir 'requirements.sha256'
if (!(Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $fingerprint) {
    & $runtime -m pip install -r $requirements
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Read the error above and retry.' }
    Set-Content -LiteralPath $marker -Value $fingerprint
}
Write-Host "AccessCart API on http://127.0.0.1:$Port (live AI unless .env sets mock)"
& $runtime -m uvicorn main:app --host 127.0.0.1 --port $Port
