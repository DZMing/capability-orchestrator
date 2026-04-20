$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TempHome = Join-Path $env:RUNNER_TEMP ('cap-orch-win-' + [guid]::NewGuid().ToString('N'))
$Env:CLAUDE_USER_DIR = $TempHome
$Env:CAPABILITY_INSTALL_CHANNEL = 'master'
$Env:CAPABILITY_INSTALL_REF = 'master'
$Env:CAPABILITY_INSTALL_REPO_URL = $RepoRoot

$InstallDir = Join-Path $TempHome 'plugins\cache\capability-orchestrator'
$SettingsFile = Join-Path $TempHome 'settings.json'

Write-Host "=== Windows install smoke test ==="
Write-Host "CLAUDE_USER_DIR=$TempHome"

& (Join-Path $RepoRoot 'install.ps1')
if ($LASTEXITCODE -ne 0) { throw 'install.ps1 failed' }

if (-not (Test-Path $InstallDir)) { throw 'plugin install dir missing' }
if (-not (Test-Path $SettingsFile)) { throw 'settings.json missing' }

$Settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json
$SessionHooks = @($Settings.hooks.SessionStart)
$PromptHooks = @($Settings.hooks.UserPromptSubmit)

if (-not ($SessionHooks | Where-Object { $_.hooks | Where-Object { $_.command -like '*scan-environment.cmd*' } })) {
  throw 'SessionStart hook does not reference scan-environment.cmd'
}
if (-not ($PromptHooks | Where-Object { $_.hooks | Where-Object { $_.command -like '*route-matcher.cmd*' } })) {
  throw 'UserPromptSubmit hook does not reference route-matcher.cmd'
}

& (Join-Path $RepoRoot 'install.ps1') -Uninstall
if ($LASTEXITCODE -ne 0) { throw 'install.ps1 -Uninstall failed' }

if (Test-Path $InstallDir) { throw 'plugin dir still exists after uninstall' }
$SettingsAfter = Get-Content $SettingsFile -Raw | ConvertFrom-Json
if ($SettingsAfter.hooks.SessionStart) {
  $OwnedSession = @($SettingsAfter.hooks.SessionStart) | Where-Object { $_.hooks | Where-Object { $_.command -like '*capability-orchestrator*' } }
  if ($OwnedSession) { throw 'owned SessionStart hooks still present after uninstall' }
}
if ($SettingsAfter.hooks.UserPromptSubmit) {
  $OwnedPrompt = @($SettingsAfter.hooks.UserPromptSubmit) | Where-Object { $_.hooks | Where-Object { $_.command -like '*capability-orchestrator*' } }
  if ($OwnedPrompt) { throw 'owned UserPromptSubmit hooks still present after uninstall' }
}

Write-Host 'Windows install smoke test passed'
