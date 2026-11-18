param([int]$Port = 8081, [int]$BackendPort = 8082, [string[]]$AllowedOrigin = @())
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path $PSScriptRoot -Parent
$runtimePath = Join-Path $workspacePath 'vendor\languagetool'
$runtimeScript = Join-Path $PSScriptRoot 'languagetool-local.cjs'
& node $runtimeScript status
if ($LASTEXITCODE -eq 0) { exit 0 }
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
$nodePath = (Get-Command node -ErrorAction Stop).Source
$scriptLiteral = "'" + $runtimeScript.Replace("'", "''") + "'"
$nodeLiteral = "'" + $nodePath.Replace("'", "''") + "'"
$commandText = "& $nodeLiteral $scriptLiteral serve --port $Port --backend-port $BackendPort"
foreach ($originValue in $AllowedOrigin) { $commandText += " --origin '" + $originValue.Replace("'", "''") + "'" }
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($commandText))
$worker = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$encodedCommand) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath 'gateway.log') -RedirectStandardError (Join-Path $runtimePath 'gateway-error.log')
for ($attempt = 0; $attempt -lt 150; $attempt++) {
    Start-Sleep -Milliseconds 250
    if ($worker.HasExited) { throw 'LanguageTool stopped during startup. See vendor/languagetool/gateway-error.log and languagetool.log.' }
    if (Test-Path -LiteralPath (Join-Path $runtimePath 'service-state.json')) {
        & node $runtimeScript status
        if ($LASTEXITCODE -eq 0) { exit 0 }
    }
}
throw 'LanguageTool startup timed out. See vendor/languagetool logs.'
