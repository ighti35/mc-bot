param(
  [string]$DependencyDirectory=(Join-Path $PSScriptRoot "../game-mod/.build"),
  [string]$BuildDirectory=(Join-Path $PSScriptRoot ".build"),
  [string]$JavaBin=(Join-Path $env:JAVA_HOME "bin")
)
$ErrorActionPreference='Stop'
$taskClasses=Join-Path $BuildDirectory 'classes'
New-Item -ItemType Directory -Path $taskClasses -Force | Out-Null
$taskClasspath=[IO.File]::ReadAllText((Join-Path $DependencyDirectory 'named-classpath.txt'))
$taskArguments=@('--release','21','-encoding','UTF-8','-proc:none','-d',('"'+$taskClasses.Replace('\','/')+'"'),'-classpath',('"'+$taskClasspath.Replace('\','/')+'"'))
$taskArguments+=Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src\main\java') -Recurse -Filter '*.java' | ForEach-Object {'"'+$_.FullName.Replace('\','/')+'"'}
$taskArgsFile=Join-Path $BuildDirectory 'javac.args'
[IO.File]::WriteAllLines($taskArgsFile,$taskArguments,[Text.UTF8Encoding]::new($false))
& (Join-Path $JavaBin 'javac.exe') ('@'+$taskArgsFile)
if($LASTEXITCODE -ne 0){throw 'Atmosphere Java compilation failed'}
Copy-Item -Path (Join-Path $PSScriptRoot 'src\main\resources\*') -Destination $taskClasses -Recurse -Force
$taskNamed=Join-Path $BuildDirectory 'anor-londo-atmosphere-named.jar'
$taskJar=Join-Path $BuildDirectory 'anor-londo-atmosphere-1.0.0.jar'
& (Join-Path $JavaBin 'jar.exe') --create --file $taskNamed -C $taskClasses .
if($LASTEXITCODE -ne 0){throw 'Atmosphere packaging failed'}
& (Join-Path $JavaBin 'java.exe') -jar (Join-Path $DependencyDirectory 'remapper.jar') $taskNamed $taskJar (Join-Path $DependencyDirectory 'mappings.tiny') named intermediary (Join-Path $DependencyDirectory 'minecraft-named.jar') --ignoreConflicts
if($LASTEXITCODE -ne 0){throw 'Atmosphere production remapping failed'}
New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot 'dist') -Force | Out-Null
Copy-Item -LiteralPath $taskJar -Destination (Join-Path $PSScriptRoot 'dist\anor-londo-atmosphere-1.0.0.jar') -Force
Get-Item -LiteralPath $taskJar | Select-Object Name,Length
