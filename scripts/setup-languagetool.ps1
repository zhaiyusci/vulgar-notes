param()
$ErrorActionPreference = 'Stop'
$runtimeScript = Join-Path $PSScriptRoot 'languagetool-local.cjs'
& node $runtimeScript setup
if ($LASTEXITCODE -ne 0) { throw 'LanguageTool setup failed.' }
