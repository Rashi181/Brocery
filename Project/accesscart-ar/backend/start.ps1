$ErrorActionPreference = 'Stop'
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCommand) {
  $runtime = $pythonCommand.Source
} else {
  $runtime = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
}
if (-not (Test-Path -LiteralPath $runtime)) { throw 'Install Python 3.12 or newer, then rerun this script.' }
& $runtime (Join-Path $PSScriptRoot 'run.py')
