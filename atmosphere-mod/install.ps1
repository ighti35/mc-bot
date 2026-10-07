param([Parameter(Mandatory=$true)][string]$GameDirectory)
$ErrorActionPreference='Stop'
$taskSource=Join-Path $PSScriptRoot 'dist\anor-londo-atmosphere-1.0.0.jar'
if(-not(Test-Path -LiteralPath $taskSource -PathType Leaf)){throw '请先执行 build.ps1'}
if(-not(Test-Path -LiteralPath (Join-Path $GameDirectory 'mods\fabric-api-0.141.6+1.21.11.jar'))){throw '目标 Fabric API 版本未安装'}
$taskDestination=Join-Path $GameDirectory 'mods\anor-londo-atmosphere-1.0.0.jar'
if(Test-Path -LiteralPath $taskDestination){
  $taskBackup=Join-Path $PSScriptRoot ('backups\'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Path $taskBackup -Force | Out-Null
  Copy-Item -LiteralPath $taskDestination -Destination $taskBackup
}
Copy-Item -LiteralPath $taskSource -Destination $taskDestination -Force
$taskConfig=Join-Path $GameDirectory 'config\anor-londo-atmosphere.json'
if(-not(Test-Path -LiteralPath $taskConfig)){
  New-Item -ItemType Directory -Path (Split-Path -Parent $taskConfig) -Force | Out-Null
  $taskDefault=Join-Path $PSScriptRoot 'default-config.json'
  if(Test-Path -LiteralPath $taskDefault){Copy-Item -LiteralPath $taskDefault -Destination $taskConfig}
}
Write-Output '亚诺尔隆德氛围模组及配置已安装。完整退出并重新启动 Minecraft 后生效。'
