Get-Content -LiteralPath (Join-Path $PSScriptRoot "data/bot.log") -Wait -Tail 50
