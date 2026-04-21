[CmdletBinding()]
param(
  [switch]$Version,
  [switch]$Uninstall,
  [ValidateSet('release', 'master')]
  [string]$Channel = $(if ($env:CAPABILITY_INSTALL_CHANNEL) { $env:CAPABILITY_INSTALL_CHANNEL } else { 'release' }),
  [string]$Platform = $env:CAPABILITY_PLATFORM
)

$ErrorActionPreference = 'Stop'

$Repo = 'DZMing/capability-orchestrator'
$RepoUrl = if ($env:CAPABILITY_INSTALL_REPO_URL) { $env:CAPABILITY_INSTALL_REPO_URL } else { "https://github.com/$Repo.git" }
$PluginName = 'capability-orchestrator'
$VersionFallback = '1.11.18'
$ScriptPath = $MyInvocation.MyCommand.Path
$ScriptDir = if ($ScriptPath) { Split-Path -Parent $ScriptPath } else { $null }
if ($ScriptDir -and ($ScriptDir -like '/dev/fd*' -or $ScriptDir -like '/proc/*/fd*')) {
  $ScriptDir = $null
}
$VersionValue = $VersionFallback
foreach ($VersionFile in @(
  $(if ($ScriptDir) { Join-Path $ScriptDir 'package.json' }),
  $(if ($ScriptDir) { Join-Path $ScriptDir '.claude-plugin\plugin.json' }),
  $(if ($ScriptDir) { Join-Path $ScriptDir '.codex-plugin\plugin.json' })
)) {
  if ($VersionFile -and (Test-Path $VersionFile)) {
    $Parsed = (Get-Content $VersionFile -Raw | ConvertFrom-Json).version
    if ($Parsed) {
      $VersionValue = $Parsed
      break
    }
  }
}

function Write-Green($Message) { Write-Host $Message -ForegroundColor Green }
function Write-Yellow($Message) { Write-Host $Message -ForegroundColor Yellow }
function Write-Red($Message) { Write-Host $Message -ForegroundColor Red }

function Resolve-LatestTag {
  try {
    $Refs = Invoke-RestMethod -Headers @{
      'User-Agent' = 'capability-orchestrator-installer'
      'Accept' = 'application/vnd.github+json'
    } -Uri "https://api.github.com/repos/$Repo/git/matching-refs/tags/"
    $Tags = $Refs.ref |
      Where-Object { $_ -like 'refs/tags/*' } |
      ForEach-Object { $_ -replace '^refs/tags/', '' } |
      Where-Object { $_ -match '^v?\d+(\.\d+)*$' } |
      Sort-Object { [version]($_ -replace '^v', '') }
    if (-not $Tags -or $Tags.Count -eq 0) { throw 'no tags found' }
    return $Tags[-1]
  } catch {
    throw '错误：无法解析最新 release tag。可显式传 CAPABILITY_INSTALL_REF 或使用 -Channel master'
  }
}

function Resolve-InstallTarget {
  if ($env:CAPABILITY_INSTALL_REF) {
    if ($env:CAPABILITY_INSTALL_REF -like 'refs/heads/*') {
      return @{ Kind = 'head'; Ref = ($env:CAPABILITY_INSTALL_REF -replace '^refs/heads/', '') }
    }
    if ($env:CAPABILITY_INSTALL_REF -like 'refs/tags/*') {
      return @{ Kind = 'tag'; Ref = ($env:CAPABILITY_INSTALL_REF -replace '^refs/tags/', '') }
    }
    if ($env:CAPABILITY_INSTALL_REF -eq 'master') {
      return @{ Kind = 'head'; Ref = 'master' }
    }
    return @{ Kind = 'tag'; Ref = $env:CAPABILITY_INSTALL_REF }
  }
  if ($Channel -eq 'master') {
    return @{ Kind = 'head'; Ref = 'master' }
  }
  return @{ Kind = 'tag'; Ref = (Resolve-LatestTag) }
}

function New-ClaudewHookCommand([string]$ScriptPath, [string[]]$Args = @()) {
  $Invocation = '"' + $ScriptPath + '"'
  if ($Args.Count -gt 0) {
    $Invocation += ' ' + ($Args -join ' ')
  }
  return 'cmd.exe /d /s /c "' + $Invocation + '"'
}

function Resolve-HelperScript {
  if ($InstallDir -and (Test-Path (Join-Path $InstallDir 'scripts\install-hooks.cjs'))) {
    return (Join-Path $InstallDir 'scripts\install-hooks.cjs')
  }
  if ($ScriptDir -and (Test-Path (Join-Path $ScriptDir 'scripts\install-hooks.cjs'))) {
    return (Join-Path $ScriptDir 'scripts\install-hooks.cjs')
  }
  throw '错误：找不到 install-hooks.cjs'
}

function Invoke-InstallHooks([string]$Mode, [string]$File, [string]$ScanCmd = '', [string]$RouteCmd = '') {
  $Args = @((Resolve-HelperScript), '--mode', $Mode, '--file', $File)
  if ($ScanCmd) { $Args += @('--scan-cmd', $ScanCmd) }
  if ($RouteCmd) { $Args += @('--route-cmd', $RouteCmd) }
  $Output = & node @Args
  if ($LASTEXITCODE -ne 0) {
    throw "hook 配置失败: $Mode"
  }
  return $Output
}

if (-not $Platform) {
  if ($env:CLAUDE_USER_DIR -or $env:CLAUDE_PLUGIN_DATA) {
    $Platform = 'claude'
  } elseif ($env:CODEX_USER_DIR -or $env:CODEX_PLUGIN_DATA) {
    $Platform = 'codex'
  } elseif (Test-Path (Join-Path $HOME '.claude')) {
    $Platform = 'claude'
  } elseif (Test-Path (Join-Path $HOME '.codex\config.toml')) {
    $Platform = 'codex'
  } else {
    $Platform = 'claude'
  }
}

if ($Platform -ne 'claude') {
  throw 'Windows native installer currently supports Claude Code only. For Codex on Windows, use WSL2 and run install.sh inside WSL.'
}

if ($Version) {
  Write-Output "$PluginName $VersionValue"
  exit 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '错误：未找到 node，请先安装 Node.js 18+'
}
if ([int](node -e "process.stdout.write(process.versions.node.split('.')[0])") -lt 18) {
  throw '错误：需要 Node.js 18+'
}

$ConfigDir = if ($env:CLAUDE_USER_DIR) { $env:CLAUDE_USER_DIR } else { Join-Path $HOME '.claude' }
$PluginsDir = Join-Path $ConfigDir 'plugins\cache'
$InstallDir = Join-Path $PluginsDir $PluginName
$SettingsFile = Join-Path $ConfigDir 'settings.json'

if ($Uninstall) {
  Write-Host '=== capability-orchestrator 卸载 ===' -ForegroundColor White
  Write-Host ''
  if (Test-Path $SettingsFile) {
    Invoke-InstallHooks -Mode 'claude-uninstall' -File $SettingsFile | Out-Null
    Write-Host 'hook 已移除'
  }
  if (Test-Path $InstallDir) {
    Remove-Item $InstallDir -Recurse -Force
    Write-Green "✓ 已删除 $InstallDir"
  } else {
    Write-Yellow '插件目录不存在，跳过'
  }
  Write-Green '✓ 卸载完成'
  exit 0
}

$Target = Resolve-InstallTarget
Write-Host '=== capability-orchestrator 安装程序 ===' -ForegroundColor White
Write-Host ''
Write-Host "安装渠道：$Channel"
Write-Host "安装目标：$($Target.Ref)"
if ($env:CAPABILITY_INSTALL_REF) {
  Write-Host '安装目标来源：CAPABILITY_INSTALL_REF'
}
Write-Host ''

New-Item -ItemType Directory -Force -Path $PluginsDir | Out-Null
$StageDir = Join-Path $PluginsDir ('.cap-orch-stage-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$StagedInstallDir = Join-Path $StageDir $PluginName
$BackupPath = $null

try {
  if (Test-Path (Join-Path $InstallDir '.git')) {
    $Dirty = (& git -C $InstallDir status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw '无法检查已安装副本的 git 状态' }
    if ($Dirty) {
      throw "更新失败（检测到已安装副本有本地修改），请手动处理：cd $InstallDir && git status"
    }
    Write-Yellow '检测到已安装（git），正在按目标 ref 重装...'
  }

  New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
  Write-Yellow "正在克隆到 $StagedInstallDir ..."
  if (Get-Command git -ErrorAction SilentlyContinue) {
    if ($Target.Kind -eq 'tag') {
      & git clone --depth=1 $RepoUrl $StagedInstallDir
      if ($LASTEXITCODE -ne 0) { throw 'git clone 失败' }
      & git -C $StagedInstallDir fetch --depth=1 origin "refs/tags/$($Target.Ref):refs/tags/$($Target.Ref)"
      if ($LASTEXITCODE -ne 0) { throw 'git fetch tag 失败' }
      & git -C $StagedInstallDir checkout -q $Target.Ref
      if ($LASTEXITCODE -ne 0) { throw 'git checkout tag 失败' }
    } else {
      & git clone --depth=1 --branch $Target.Ref $RepoUrl $StagedInstallDir
      if ($LASTEXITCODE -ne 0) { throw 'git clone branch 失败' }
    }
  } else {
    if ($env:CAPABILITY_INSTALL_REPO_URL) {
      throw '错误：本地/自定义 CAPABILITY_INSTALL_REPO_URL 需要 git clone，但当前环境未找到 git'
    }
    $TmpZip = Join-Path ([IO.Path]::GetTempPath()) ('cap-orch-' + [guid]::NewGuid().ToString('N') + '.zip')
    $TmpDir = Join-Path ([IO.Path]::GetTempPath()) ('cap-orch-' + [guid]::NewGuid().ToString('N'))
    $ZipRef = if ($Target.Kind -eq 'tag') { "refs/tags/$($Target.Ref)" } else { "refs/heads/$($Target.Ref)" }
    Invoke-WebRequest -Uri "https://github.com/$Repo/archive/$ZipRef.zip" -OutFile $TmpZip
    Expand-Archive -Path $TmpZip -DestinationPath $TmpDir -Force
    $Extracted = Get-ChildItem -Path $TmpDir -Directory | Select-Object -First 1
    Move-Item $Extracted.FullName $StagedInstallDir
    Remove-Item $TmpZip -Force
    Remove-Item $TmpDir -Recurse -Force
  }

  if (Test-Path $InstallDir) {
    $BackupPath = Join-Path $PluginsDir ('.cap-orch-backup-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    Move-Item $InstallDir $BackupPath
  }
  Move-Item $StagedInstallDir $InstallDir
  Remove-Item $StageDir -Recurse -Force
  $StageDir = $null

  $ScanCmd = New-ClaudewHookCommand -ScriptPath (Join-Path $InstallDir 'scripts\scan-environment.cmd') -Args @('--mode=awareness')
  $RouteCmd = New-ClaudewHookCommand -ScriptPath (Join-Path $InstallDir 'scripts\route-matcher.cmd')
  $Result = Invoke-InstallHooks -Mode 'claude-install' -File $SettingsFile -ScanCmd $ScanCmd -RouteCmd $RouteCmd | ConvertFrom-Json

  Write-Yellow '正在注册 SessionStart hook...'
  Write-Host $Result.sessionStatus
  Write-Yellow '正在注册 UserPromptSubmit hook...'
  Write-Host $Result.routeStatus
  Write-Host ''
  Write-Green "✓ 安装完成：$InstallDir (平台: claude)"
  Write-Green '✓ SessionStart hook 已注册（每次新会话自动注入能力摘要）'
  Write-Green '✓ UserPromptSubmit hook 已注册（每条消息自动匹配 skill）'
  Write-Host ''
  Write-Host '使用方式：' -ForegroundColor White
  Write-Host '  /capability-orchestrator:capabilities — 查看完整能力摘要'
  Write-Host '  /capability-orchestrator:orchestrate  — 路由复杂任务'
  Write-Host '  /capability-orchestrator:refresh      — 对比前后能力变化'
  Write-Host ''
  Write-Yellow '提示：重启 Claude Code 开新会话后生效'
} catch {
  if ($BackupPath -and (Test-Path $BackupPath)) {
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
    Move-Item $BackupPath $InstallDir -Force
  }
  throw
} finally {
  if ($StageDir -and (Test-Path $StageDir)) { Remove-Item $StageDir -Recurse -Force }
  if ($BackupPath -and (Test-Path $BackupPath)) { Remove-Item $BackupPath -Recurse -Force }
}
