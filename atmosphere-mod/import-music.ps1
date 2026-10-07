param(
  [Parameter(Mandatory=$true)][string]$AudioFile,
  [string]$CombatFile,
  [string]$DarkFile,
  [Parameter(Mandatory=$true)][string]$GameDirectory,
  [string]$Ffmpeg='ffmpeg'
)
$ErrorActionPreference='Stop'
$taskPack=Join-Path $GameDirectory 'resourcepacks\AnorLondoMusic'
$taskSounds=Join-Path $taskPack 'assets\anorlondo\sounds'
New-Item -ItemType Directory -Path $taskSounds -Force | Out-Null
function Import-Track([string]$Source,[string]$Name){
$taskSource=(Resolve-Path -LiteralPath $Source).Path
if(-not(Test-Path -LiteralPath $taskSource -PathType Leaf)){throw '找不到音轨文件'}
$taskDestination=Join-Path $taskSounds ($Name+'.ogg')
$taskTemp=Join-Path $taskSounds ($Name+'.importing.ogg')
if([IO.Path]::GetExtension($taskSource) -ieq '.ogg'){
  $taskInput=[IO.File]::OpenRead($taskSource)
  try{$taskHeader=[byte[]]::new(128);$taskRead=$taskInput.Read($taskHeader,0,128);$taskMagic=[Text.Encoding]::ASCII.GetString($taskHeader,0,$taskRead)}finally{$taskInput.Dispose()}
  if(-not $taskMagic.StartsWith('OggS') -or -not $taskMagic.Contains('vorbis')){throw '需要 Ogg Vorbis 音频；Opus 不兼容 Minecraft'}
  Copy-Item -LiteralPath $taskSource -Destination $taskTemp -Force
}else{
  $taskEncoder=Get-Command $Ffmpeg -ErrorAction Stop
  & $taskEncoder.Source -hide_banner -loglevel error -y -i $taskSource -vn -ac 2 -ar 44100 -c:a libvorbis -q:a 5 $taskTemp
  if($LASTEXITCODE -ne 0){throw '音轨转换失败'}
}
Move-Item -LiteralPath $taskTemp -Destination $taskDestination -Force
}
Import-Track $AudioFile 'ambient'
if($CombatFile){Import-Track $CombatFile 'combat'}
if($DarkFile){Import-Track $DarkFile 'dark'}
$taskUtf8=[Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $taskPack 'pack.mcmeta'),'{"pack":{"description":"亚诺尔隆德 · 用户本机原声音乐","min_format":75,"max_format":75}}',$taskUtf8)
$taskEvents=@{}
foreach($taskName in @('ambient','combat','dark')){
  if(Test-Path -LiteralPath (Join-Path $taskSounds ($taskName+'.ogg'))){$taskEvents[$taskName]=@{sounds=@(@{name=('anorlondo:'+$taskName);stream=$true})}}
}
[IO.File]::WriteAllText((Join-Path $taskPack 'assets\anorlondo\sounds.json'),($taskEvents|ConvertTo-Json -Depth 5),$taskUtf8)
Write-Output '音轨已导入。重启加载模组后自动启用；也可执行 /anorlondo music 重载资源。'
