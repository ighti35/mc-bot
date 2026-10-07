param([switch]$SelfTest,[string]$PreviewPath)
$ErrorActionPreference='Stop'
$script:BundleRoot=$PSScriptRoot
$script:Utf8=New-Object System.Text.UTF8Encoding($false)
function Read-Json($Path) { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
function Write-Json($Path,$Value) {
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
    $temp=$Path+'.tmp'
    [IO.File]::WriteAllText($temp,($Value | ConvertTo-Json -Depth 30),$script:Utf8)
    Move-Item -LiteralPath $temp -Destination $Path -Force
}
function Get-InstanceInfo([string]$Directory,[bool]$Atmosphere=$false) {
    if(-not(Test-Path -LiteralPath $Directory -PathType Container)){throw '请选择存在的 Minecraft 版本目录。'}
    $metadata=@(Get-ChildItem -LiteralPath $Directory -Filter '*.json' -File | ForEach-Object {
        try {Read-Json $_.FullName} catch {}
    })
    $match=@($metadata | Where-Object {
        $_.inheritsFrom -eq '1.21.11' -or $_.id -eq '1.21.11' -or $_.id -match '(?:^|-)1\.21\.11(?:$|-)' -or
        $_.arguments.game -contains '1.21.11'
    })
    if(-not $match.Count){throw '未检测到 Minecraft 1.21.11。请在 PCL 中先安装该版本，再安装 Fabric。'}
    $loader=@($match | ForEach-Object {$_.libraries} | Where-Object {$_.name -match '^net\.fabricmc:fabric-loader:'})
    if(-not $loader.Count){throw '该版本没有 Fabric Loader。请在 PCL 的版本管理中安装 Fabric 0.19.3 或更高版本。'}
    $version=($loader[0].name -split ':')[-1]
    $minimum=if($Atmosphere){[version]'0.19.3'}else{[version]'0.19.2'}
    if([version]$version -lt $minimum){throw "Fabric Loader $version 太旧，需要 $minimum 或更高版本。"}
    return @{ Directory=[IO.Path]::GetFullPath($Directory); Loader=$version }
}
function Assert-Config($Values) {
    foreach($field in @('host','owner','username','aiApiKey','aiApiUrl','aiModel')) {
        if(-not [string]$Values.$field -or -not ([string]$Values.$field).Trim()){throw "请填写 $field。"}
    }
    if($Values.owner -notmatch '^[A-Za-z0-9_]{1,16}$' -or $Values.username -notmatch '^[A-Za-z0-9_]{1,16}$'){throw '玩家名和机器人名只能使用 1–16 个英文字母、数字或下划线。'}
    if($Values.owner -eq $Values.username){throw '玩家名不能与机器人名相同。'}
    $port=0
    if(-not [int]::TryParse([string]$Values.port,[ref]$port) -or $port -lt 1 -or $port -gt 65535){throw '局域网端口必须是 1–65535 的整数。'}
    if($port -eq 52592){throw '52592 是游戏内菜单的接口端口，请填写世界实际开放的端口。'}
    $uri=$null
    if(-not [Uri]::TryCreate([string]$Values.aiApiUrl,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -notin @('https','http') -or $uri.UserInfo){throw 'API 地址必须是有效的 HTTP/HTTPS 地址，不能包含账号密码。'}
    if($uri.Scheme -eq 'http' -and -not $uri.IsLoopback){throw '远程 API 请使用 HTTPS，避免明文发送 API Key。'}
}
function Install-Mods($InstanceDirectory,[bool]$Isolated,[bool]$Atmosphere) {
    $info=Get-InstanceInfo $InstanceDirectory $Atmosphere
    $game=if($Isolated){$info.Directory}else{
        $parent=Split-Path -Parent $info.Directory
        if((Split-Path -Leaf $parent) -ne 'versions'){throw '关闭版本隔离时，所选目录必须位于 .minecraft\versions 下。'}
        Split-Path -Parent $parent
    }
    $mods=Join-Path $game 'mods'
    [IO.Directory]::CreateDirectory($mods) | Out-Null
    $jars=@(Get-ChildItem -LiteralPath (Join-Path $script:BundleRoot 'mods') -Filter '*.jar' -File | Where-Object {$Atmosphere -or $_.Name -notlike 'anor-londo-*'})
    # Preserve old versions outside mods so Fabric will not load duplicate mod IDs.
    foreach($jar in $jars) {
        $prefix=if($jar.Name -like 'fabric-api-*'){'fabric-api-'}elseif($jar.Name -like 'bot-inventory-*'){'bot-inventory-'}else{'anor-londo-atmosphere-'}
        foreach($old in @(Get-ChildItem -LiteralPath $mods -Filter ($prefix+'*.jar') -File)) {
            $backup=Join-Path $game ('claude-bot-backups\'+(Get-Date -Format 'yyyyMMdd-HHmmssfff'))
            [IO.Directory]::CreateDirectory($backup) | Out-Null
            Move-Item -LiteralPath $old.FullName -Destination (Join-Path $backup $old.Name)
        }
        Copy-Item -LiteralPath $jar.FullName -Destination (Join-Path $mods $jar.Name) -Force
    }
    if($Atmosphere){
        $pack=Join-Path $game 'resourcepacks\AnorLondoMusic'
        if(Test-Path -LiteralPath $pack){
            $backup=Join-Path $game ('claude-bot-backups\music-'+(Get-Date -Format 'yyyyMMdd-HHmmssfff'))
            [IO.Directory]::CreateDirectory($backup) | Out-Null
            Copy-Item -LiteralPath $pack -Destination $backup -Recurse
        }
        [IO.Directory]::CreateDirectory($pack) | Out-Null
        Copy-Item -Path (Join-Path $script:BundleRoot 'resourcepacks\AnorLondoMusic\*') -Destination $pack -Recurse -Force
    }
    return $game
}
if($SelfTest) {
    $temp=Join-Path ([IO.Path]::GetTempPath()) ('mc-bot-installer-test-'+[Guid]::NewGuid())
    [IO.Directory]::CreateDirectory($temp) | Out-Null
    try {
        $instance=Join-Path $temp '.minecraft\versions\fabric-test'
        [IO.Directory]::CreateDirectory($instance) | Out-Null
        Write-Json (Join-Path $instance 'fabric-test.json') @{id='fabric-test';inheritsFrom='1.21.11';libraries=@(@{name='net.fabricmc:fabric-loader:0.19.3'})}
        $null=Get-InstanceInfo $instance $true
        $good=@{host='127.0.0.1';port=25565;owner='Player';username='Claude_Bot';aiApiKey='test-placeholder';aiApiUrl='https://api.deepseek.com/v1/chat/completions';aiModel='deepseek-flash'}
        Assert-Config $good
        $good.port=52592
        $rejected=$false;try{Assert-Config $good}catch{$rejected=$true}
        if(-not $rejected){throw 'Conflicting port accepted'}
        $good.port=25565; $good.aiApiUrl='http://example.com/v1/chat/completions'
        $rejected=$false;try{Assert-Config $good}catch{$rejected=$true}
        if(-not $rejected){throw 'Insecure remote API accepted'}
        $game=Install-Mods $instance $true $true
        if(@(Get-ChildItem (Join-Path $game 'mods') -Filter '*.jar').Count -ne 3){throw 'Mod installation failed'}
        foreach($name in @('ambient','combat','dark')){
            if(-not(Test-Path (Join-Path $game ('resourcepacks\AnorLondoMusic\assets\anorlondo\sounds\'+$name+'.ogg')))){throw 'Music installation failed'}
        }
        $null=Install-Mods $instance $true $false
        if(-not(Test-Path (Join-Path $game 'claude-bot-backups'))){throw 'Backup failed'}
        $shared=Install-Mods $instance $false $false
        if(@(Get-ChildItem (Join-Path $shared 'mods') -Filter '*.jar').Count -ne 2){throw 'Shared directory failed'}
        Write-Output 'PASS: config validation, Fabric detection, isolated/shared installation, mod backup'
    } finally {
        $full=[IO.Path]::GetFullPath($temp)
        if($full.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath())) -and (Split-Path -Leaf $full) -like 'mc-bot-installer-test-*'){Remove-Item -LiteralPath $full -Recurse -Force}
    }
    exit
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form=New-Object Windows.Forms.Form
$form.Text='Claude Bot 2.0 · 一键安装与配置'
$form.Size=New-Object Drawing.Size(850,790)
$form.MinimumSize=$form.Size
$form.StartPosition='CenterScreen'
$form.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
$form.BackColor=[Drawing.Color]::FromArgb(245,247,250)
$form.AutoScroll=$true
$script:fields=@{}
function Label($Text,$X,$Y,$Width=760) {
    $c=New-Object Windows.Forms.Label; $c.Text=$Text; $c.SetBounds($X,$Y,$Width,24);$form.Controls.Add($c);return $c
}
function Field($Name,$Title,$Y,$Value,$Secret=$false) {
    $null=Label $Title 24 $Y 175
    $c=New-Object Windows.Forms.TextBox;$c.SetBounds(205,$Y-2,585,28);$c.Text=[string]$Value;$c.UseSystemPasswordChar=$Secret
    $form.Controls.Add($c);$script:fields[$Name]=$c;return $c
}
function Button($Text,$X,$Y,$Width,$Action) {
    $c=New-Object Windows.Forms.Button;$c.Text=$Text;$c.SetBounds($X,$Y,$Width,36);$c.Add_Click($Action);$form.Controls.Add($c);return $c
}
function Browse-Folder($Title,$Control) {
    $d=New-Object Windows.Forms.FolderBrowserDialog;$d.Description=$Title
    if(Test-Path -LiteralPath $Control.Text){$d.SelectedPath=$Control.Text}
    if($d.ShowDialog() -eq 'OK'){$Control.Text=$d.SelectedPath}
    $d.Dispose()
}
$title=Label 'Claude Bot · 开箱即用整合包' 24 15
$title.Font=New-Object Drawing.Font('Microsoft YaHei UI',17,[Drawing.FontStyle]::Bold);$title.Height=36
$null=Label 'Windows x64 · Minecraft 1.21.11 · PCL + Fabric · 无需另装 Node.js' 24 56
$initialRoot=Join-Path $env:LOCALAPPDATA 'ClaudeBot'
$locator=Join-Path $env:LOCALAPPDATA 'ClaudeBotInstaller\last-install.json'
if(Test-Path -LiteralPath $locator){try{$savedRoot=(Read-Json $locator).install;if(Test-Path -LiteralPath $savedRoot){$initialRoot=$savedRoot}}catch{}}
$null=Field 'install' '机器人安装位置' 94 $initialRoot
$script:fields.install.Width=475
$null=Button '选择…' 690 90 100 {Browse-Folder '选择机器人的安装目录' $script:fields.install}
$defaults=Read-Json (Join-Path $PSScriptRoot 'app\config.example.json')
$existing=Join-Path $script:fields.install.Text 'app\config.json'
if(Test-Path -LiteralPath $existing){try{$defaults=Read-Json $existing}catch{}}
$null=Field 'owner' '你的游戏名' 134 $(if($defaults.owner -eq 'YourMinecraftName'){''}else{$defaults.owner})
$null=Field 'username' '机器人游戏名' 174 $defaults.username
$null=Field 'host' '服务器地址' 214 $defaults.host
$null=Field 'port' '世界局域网端口' 254 $defaults.port
$null=Field 'aiApiKey' 'API Key' 294 $defaults.aiApiKey $true
$show=New-Object Windows.Forms.CheckBox;$show.Text='显示密钥';$show.SetBounds(690,321,100,26);$show.Add_CheckedChanged({$script:fields.aiApiKey.UseSystemPasswordChar=-not $show.Checked});$form.Controls.Add($show)
$null=Field 'aiApiUrl' 'API 完整请求地址' 354 $defaults.aiApiUrl
$null=Field 'aiModel' '模型名称' 394 $defaults.aiModel
$null=Label '游戏内菜单接口固定为 52592；API Key 仅保存到你的本机配置文件。' 205 426 590
$null=Field 'instance' 'PCL 的 Fabric 版本目录' 464 ''
$script:fields.instance.Width=475
$null=Button '选择…' 690 460 100 {Browse-Folder '选择 .minecraft\versions 下的 Fabric 1.21.11 版本文件夹（含版本 JSON）' $script:fields.instance}
$isolated=New-Object Windows.Forms.CheckBox;$isolated.Text='PCL 已开启该版本的版本隔离（mods 放在版本文件夹中）';$isolated.Checked=$true;$isolated.SetBounds(205,495,585,28);$form.Controls.Add($isolated)
$atmo=New-Object Windows.Forms.CheckBox;$atmo.Text='安装亚诺尔隆德氛围与三首音乐（效果需设定存档与建筑区域）';$atmo.Checked=$true;$atmo.SetBounds(205,525,590,28);$form.Controls.Add($atmo)
$script:fields.instance.Add_TextChanged({
    $setup=Join-Path $script:fields.instance.Text 'PCL\Setup.ini'
    if(Test-Path -LiteralPath $setup){
        $content=Get-Content -LiteralPath $setup -Raw
        if($content -match '(?m)^VersionArgumentIndieV2:(True|False)\s*$'){$isolated.Checked=$Matches[1] -eq 'True'}
    }
})
$null=Label '安装模组前请退出游戏；在 PCL 确认版本隔离设置与上方一致。' 24 560
$script:status=Label '准备就绪：填写信息后点击“一键安装并保存”。' 24 602
$script:status.Height=50;$script:status.ForeColor=[Drawing.Color]::FromArgb(35,85,135)
$script:busy=$false
function Operation($Action) {
    if($script:busy){return}
    $script:busy=$true
    try{& $Action}catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'操作未完成','OK','Warning') | Out-Null;$script:status.Text='操作未完成，请按提示处理。'}finally{$script:busy=$false}
}
function Status($Message){$script:status.Text=$Message;[Windows.Forms.Application]::DoEvents()}
function Save-Configuration([bool]$InstallMods=$false) {
    $values=@{}
    foreach($name in @('owner','username','host','port','aiApiKey','aiApiUrl','aiModel')){$values[$name]=$script:fields[$name].Text.Trim()}
    Assert-Config $values
    $root=[IO.Path]::GetFullPath($script:fields.install.Text)
    if($root -eq [IO.Path]::GetPathRoot($root)){throw '请选择专门的机器人文件夹，不能直接安装到磁盘根目录。'}
    if($root.StartsWith([IO.Path]::GetFullPath($script:BundleRoot)+'\',[StringComparison]::OrdinalIgnoreCase) -or $root -eq [IO.Path]::GetFullPath($script:BundleRoot)){throw '请选择整合包目录之外的安装位置。'}
    if($InstallMods){$null=Get-InstanceInfo $script:fields.instance.Text $atmo.Checked}
    $app=Join-Path $root 'app';$runtime=Join-Path $root 'runtime'
    if($InstallMods -and (Test-Path (Join-Path $root 'launcher-process.json'))){
        $r=Read-Json (Join-Path $root 'launcher-process.json')
        $running=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$r.pid)
        if($running -and $running.ExecutablePath -eq $r.node -and $running.CommandLine.Contains($r.entry)){throw '请先点击“停止机器人”，再重新安装或更新。'}
    }
    [IO.Directory]::CreateDirectory($app)|Out-Null;[IO.Directory]::CreateDirectory($runtime)|Out-Null
    if(-not(Test-Path (Join-Path $app 'package.json')) -or $InstallMods){
        Status '正在安装机器人、依赖和建筑图纸，请稍候…'
        Copy-Item -Path (Join-Path $script:BundleRoot 'app\*') -Destination $app -Recurse -Force
        Copy-Item -Path (Join-Path $script:BundleRoot 'runtime\*') -Destination $runtime -Recurse -Force
    }
    $path=Join-Path $app 'config.json'
    $config=if(Test-Path -LiteralPath $path){Read-Json $path}else{Read-Json (Join-Path $app 'config.example.json')}
    foreach($name in $values.Keys){$config | Add-Member -MemberType NoteProperty -Name $name -Value $values[$name] -Force}
    $config.port=[int]$config.port;$config.inventoryPanelPort=52592;$config.version='1.21.11'
    Write-Json $path $config
    $game=''
    if($InstallMods){Status '正在安装游戏内背包、建筑菜单和 Fabric API…';$game=Install-Mods $script:fields.instance.Text $isolated.Checked $atmo.Checked}
    Write-Json (Join-Path $root 'installer-settings.json') @{instance=$script:fields.instance.Text;isolated=$isolated.Checked;atmosphere=$atmo.Checked;gameDirectory=$game}
    Write-Json (Join-Path $env:LOCALAPPDATA 'ClaudeBotInstaller\last-install.json') @{install=$root}
    Status '配置已保存。请用 PCL 启动游戏，进入世界并开放局域网，然后启动机器人。'
    return $root
}
function Launch-Helper($Arguments) {
    $root=Save-Configuration
    $si=New-Object Diagnostics.ProcessStartInfo
    $si.FileName=Join-Path $root 'runtime\node.exe';$si.Arguments='"'+(Join-Path $script:BundleRoot 'check-connection.cjs')+'" "'+(Join-Path $root 'app\config.json')+'" '+$Arguments
    $si.UseShellExecute=$false;$si.CreateNoWindow=$true;$si.RedirectStandardOutput=$true;$si.RedirectStandardError=$true
    $p=New-Object Diagnostics.Process;$p.StartInfo=$si;$null=$p.Start()
    $out=$p.StandardOutput.ReadToEndAsync();$err=$p.StandardError.ReadToEndAsync()
    while(-not $p.HasExited){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 75}
    $message=$out.Result.Trim()
    if(-not $message){$message='连接检查失败。请检查配置和网络。'}
    Status $message
    [Windows.Forms.MessageBox]::Show($message,'连接检查','OK',$(if($p.ExitCode -eq 0){'Information'}else{'Warning'}))|Out-Null
    $p.Dispose()
}
$null=Button '一键安装并保存' 24 660 180 {Operation {$null=Save-Configuration $true}}
$null=Button '测试游戏连接' 218 660 135 {Operation {Status '正在检查 Minecraft 连接…';Launch-Helper 'minecraft'}}
$null=Button '测试 API' 366 660 110 {Operation {Status '正在测试 API（发送一条简短请求）…';Launch-Helper 'api'}}
$null=Button '启动机器人' 489 660 135 {Operation {
    $root=Save-Configuration
    $tcp=New-Object Net.Sockets.TcpClient
    try { $task=$tcp.ConnectAsync('127.0.0.1',52592);if($task.Wait(500) -and $tcp.Connected){throw '52592 已被占用，机器人可能已在运行。请先停止已有机器人或关闭占用端口的程序。'} } catch [AggregateException] {} finally{$tcp.Dispose()}
    $data=Join-Path $root 'app\data';[IO.Directory]::CreateDirectory($data)|Out-Null
    $node=Join-Path $root 'runtime\node.exe';$entry=Join-Path $root 'app\index.js'
    $p=Start-Process -FilePath $node -ArgumentList ('"'+$entry+'"') -WorkingDirectory (Join-Path $root 'app') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $data 'launcher.stdout.log') -RedirectStandardError (Join-Path $data 'launcher.stderr.log')
    Write-Json (Join-Path $root 'launcher-process.json') @{pid=$p.Id;node=$node;entry=$entry}
    Status '机器人已启动。若未进入世界，点击“打开日志”查看原因。'
}}
$null=Button '停止机器人' 637 660 153 {Operation {
    $root=[IO.Path]::GetFullPath($script:fields.install.Text);$file=Join-Path $root 'launcher-process.json'
    if(-not(Test-Path $file)){throw '没有通过本面板启动的机器人记录。'}
    $record=Read-Json $file;$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$record.pid)
    if($p -and $p.ExecutablePath -eq $record.node -and $p.CommandLine.Contains($record.entry)){Stop-Process -Id $record.pid -Force;Status '本面板启动的机器人已停止。'}else{Status '机器人已退出。'}
}}
$null=Button '打开网页面板' 24 706 180 {Operation {Start-Process 'http://127.0.0.1:52592/'}}
$null=Button '打开日志' 218 706 135 {Operation {
    $data=Join-Path $script:fields.install.Text 'app\data'
    if(-not(Test-Path (Join-Path $data 'launcher.stdout.log'))){throw '尚无启动日志。'}
    $dialog=New-Object Windows.Forms.Form;$dialog.Text='机器人日志';$dialog.Size=New-Object Drawing.Size(850,600);$dialog.StartPosition='CenterParent'
    $text=New-Object Windows.Forms.TextBox;$text.Multiline=$true;$text.ReadOnly=$true;$text.ScrollBars='Both';$text.WordWrap=$false;$text.Dock='Fill'
    $text.Font=New-Object Drawing.Font('Consolas',10)
    $stdout=Get-Content -LiteralPath (Join-Path $data 'launcher.stdout.log') -Tail 160 -Encoding UTF8
    $stderr=Get-Content -LiteralPath (Join-Path $data 'launcher.stderr.log') -Tail 80 -Encoding UTF8 -ErrorAction SilentlyContinue
    $text.Text=("=== 错误日志 ===`r`n"+($stderr -join "`r`n")+"`r`n=== 运行日志 ===`r`n"+($stdout -join "`r`n"))
    $dialog.Controls.Add($text);$null=$dialog.ShowDialog($form);$dialog.Dispose()
}}
$null=Button '使用说明' 366 706 110 {Start-Process notepad.exe -ArgumentList ('"'+(Join-Path $script:BundleRoot '使用说明.txt')+'"')}
$null=Button '保存配置' 489 706 135 {Operation {$null=Save-Configuration}}
$null=Button '打开安装目录' 637 706 153 {Operation {
    if(-not(Test-Path -LiteralPath $script:fields.install.Text)){throw '请先安装机器人。'}
    Start-Process explorer.exe -ArgumentList ('"'+$script:fields.install.Text+'"')
}}
$settings=Join-Path $script:fields.install.Text 'installer-settings.json'
if(Test-Path $settings){try{$s=Read-Json $settings;$script:fields.instance.Text=$s.instance;$isolated.Checked=[bool]$s.isolated;$atmo.Checked=[bool]$s.atmosphere}catch{}}
$form.Add_FormClosing({param($sender,$eventArgs) if($script:busy){$eventArgs.Cancel=$true}})
if($PreviewPath){
    $form.StartPosition='Manual';$form.Location=New-Object Drawing.Point(-32000,-32000)
    $form.Show();[Windows.Forms.Application]::DoEvents();$form.PerformLayout()
    $bitmap=New-Object Drawing.Bitmap($form.Width,$form.Height)
    $form.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)))
    $bitmap.Save($PreviewPath,[Drawing.Imaging.ImageFormat]::Png);$bitmap.Dispose();$form.Dispose();exit
}
$null=$form.ShowDialog()
