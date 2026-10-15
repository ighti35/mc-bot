param(
  [Parameter(Mandatory=$true)][string]$GameRoot,
  [string]$JavaBin = (Join-Path $env:JAVA_HOME "bin"),
  [string]$BuildDirectory = (Join-Path $PSScriptRoot ".build")
)
$ErrorActionPreference = 'Stop'
$sourceRoot = Join-Path $PSScriptRoot 'src\main'
$classesPath = Join-Path $BuildDirectory 'classes'
New-Item -ItemType Directory -Path $classesPath -Force | Out-Null
$baseManifest = Get-Content -LiteralPath (Join-Path $GameRoot 'versions\1.21.11\1.21.11.json') -Raw | ConvertFrom-Json
$loaderManifest = Get-Content -LiteralPath (Join-Path $GameRoot 'versions\fabric-loader-0.19.3-1.21.11\fabric-loader-0.19.3-1.21.11.json') -Raw | ConvertFrom-Json
$libraries = @()
foreach ($library in $baseManifest.libraries) {
  if ($library.downloads.artifact.path) { $libraries += Join-Path $GameRoot ('libraries\' + $library.downloads.artifact.path) }
}
foreach ($library in $loaderManifest.libraries) {
  $coordinates = $library.name.Split(':')
  $relative = $coordinates[0].Replace('.', '/') + '/' + $coordinates[1] + '/' + $coordinates[2] + '/' + $coordinates[1] + '-' + $coordinates[2] + '.jar'
  $libraries += Join-Path $GameRoot ('libraries\' + $relative)
}
$libraries = $libraries | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -Unique
$apiFiles = Get-ChildItem -LiteralPath (Join-Path $BuildDirectory 'api-named') -Filter '*.jar'
$classPath = (Join-Path $BuildDirectory 'minecraft-named.jar') + ';' + (($apiFiles.FullName + $libraries) -join ';')
$arguments = @('--release', '21', '-encoding', 'UTF-8', '-proc:none', '-d', ('"' + $classesPath.Replace('\','/') + '"'), '-classpath', ('"' + $classPath.Replace('\','/') + '"'))
$arguments += Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'java') -Recurse -Filter '*.java' | ForEach-Object { '"' + $_.FullName.Replace('\','/') + '"' }
$argFile = Join-Path $BuildDirectory 'javac.args'
[IO.File]::WriteAllLines($argFile, $arguments, [Text.UTF8Encoding]::new($false))
& (Join-Path $JavaBin 'javac.exe') ('@' + $argFile)
if ($LASTEXITCODE -ne 0) { throw 'Java compilation failed' }
Copy-Item -LiteralPath (Join-Path $sourceRoot 'resources\fabric.mod.json') -Destination (Join-Path $classesPath 'fabric.mod.json') -Force
& (Join-Path $JavaBin 'jar.exe') --create --file (Join-Path $BuildDirectory 'bot-inventory-named.jar') -C $classesPath .
if ($LASTEXITCODE -ne 0) { throw 'JAR packaging failed' }
& (Join-Path $JavaBin 'java.exe') -jar (Join-Path $BuildDirectory 'remapper.jar') (Join-Path $BuildDirectory 'bot-inventory-named.jar') (Join-Path $BuildDirectory 'bot-inventory-1.0.0.jar') (Join-Path $BuildDirectory 'mappings.tiny') named intermediary (Join-Path $BuildDirectory 'minecraft-named.jar') --ignoreConflicts
if ($LASTEXITCODE -ne 0) { throw 'Production remapping failed' }
[IO.File]::WriteAllText((Join-Path $BuildDirectory 'named-classpath.txt'), $classPath, [Text.UTF8Encoding]::new($false))
Get-Item -LiteralPath (Join-Path $BuildDirectory 'bot-inventory-1.0.0.jar') | Select-Object Name, Length
