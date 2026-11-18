param()
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'languagetool-local.cjs') stop
if ($LASTEXITCODE -ne 0) { throw 'Could not stop this local LanguageTool runtime.' }
