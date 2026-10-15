param([Parameter(Mandatory=$true)][string]$GameDirectory)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath $GameDirectory -PathType Container)){throw '请选择实际 Minecraft 游戏目录（版本隔离时为版本目录）。'}
$source=Join-Path $PSScriptRoot 'resourcepacks\AnorLondoMusic'
if(-not(Test-Path -LiteralPath $source -PathType Container)){throw '音乐资源包不存在。'}
$destination=Join-Path $GameDirectory 'resourcepacks\AnorLondoMusic'
if(Test-Path -LiteralPath $destination){
    $backup=Join-Path $GameDirectory ('claude-bot-backups\music-'+(Get-Date -Format 'yyyyMMdd-HHmmssfff'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item -LiteralPath $destination -Destination $backup -Recurse
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force
Write-Output '三首亚诺尔隆德音乐已安装。请安装氛围模组并配置存档与区域；模组会自动启用音乐包。'
