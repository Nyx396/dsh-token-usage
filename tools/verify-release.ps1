#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ZipPath,
    [switch]$SkipFakeMachine
)
# Release verification. Pure ASCII: Windows PowerShell 5.1 reads BOM-less
# scripts as ANSI, so Chinese paths are built from code points below.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ZipPath)) {
    $candidate = @(Get-ChildItem -LiteralPath (Split-Path -Parent $root) -File -Filter 'dsh-token-usage-*-win-x64.zip' | Sort-Object LastWriteTime -Descending)
    if ($candidate.Count -eq 0) { throw 'No release ZIP found beside the project directory. Pass -ZipPath.' }
    $ZipPath = $candidate[0].FullName
}
$ZipPath = [IO.Path]::GetFullPath($ZipPath)
$checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw ('VERIFY FAILED: ' + $Message) }
    $script:checks++
    Write-Host ('[PASS] ' + $Message)
}
$utf8 = New-Object Text.UTF8Encoding($false)

# --- 1. sidecar ------------------------------------------------------------
$sidecar = $ZipPath + '.sha256.txt'
Assert-True (Test-Path -LiteralPath $sidecar -PathType Leaf) 'sidecar checksum file exists'
$zipHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sidecarHash = ([IO.File]::ReadAllText($sidecar)).Trim().Split(' ')[0].ToLowerInvariant()
Assert-True ($sidecarHash -eq $zipHash) 'sidecar SHA-256 matches the ZIP'

# --- 2. entries ------------------------------------------------------------
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
try { $entries = @($zip.Entries | ForEach-Object { $_.FullName }) } finally { $zip.Dispose() }
$txt = ([string][char]0x4F7F) + [char]0x7528 + [char]0x8BF4 + [char]0x660E + '.txt'
$installCmd = ([string][char]0x5B89) + [char]0x88C5 + '.cmd'
$uninstallCmd = ([string][char]0x5378) + [char]0x8F7D + '.cmd'
$checkCmd = ([string][char]0x68C0) + [char]0x67E5 + [char]0x73AF + [char]0x5883 + '.cmd'
$expected = @(
    'plugin/package.json', 'plugin/cordis.patch.yml', 'plugin/lib/index.js', 'plugin/lib/core.js', 'plugin/lib/client.js',
    'tools/portable.ps1', $txt, $installCmd, $uninstallCmd, $checkCmd, 'SHA256SUMS.txt'
)
foreach ($name in $expected) { Assert-True ($entries -contains $name) ('ZIP contains ' + $name) }
Assert-True (@($entries | Where-Object { $_.Contains('\') }).Count -eq 0) 'ZIP entry names use forward slashes'
Assert-True (@($entries | Where-Object { $expected -notcontains $_ }).Count -eq 0) 'ZIP contains no unexpected entries'

# --- 3. extract and verify per-file checksums ------------------------------
$work = Join-Path ([IO.Path]::GetTempPath()) ('dsh-tku-verify-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    [IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $work)
    $stage = $work
    $sumsPath = Join-Path $stage 'SHA256SUMS.txt'
    $lines = @([IO.File]::ReadAllLines($sumsPath) | Where-Object { $_.Trim() })
    Assert-True ($lines.Count -eq ($entries.Count - 1)) 'SHA256SUMS covers every payload entry'
    foreach ($line in $lines) {
        $parts = $line -split '  ', 2
        $file = Join-Path $stage ($parts[1].Replace('/', '\'))
        Assert-True (Test-Path -LiteralPath $file -PathType Leaf) ('checksummed file exists: ' + $parts[1])
        Assert-True ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -eq $parts[0].ToLowerInvariant()) ('checksum matches: ' + $parts[1])
    }

    # --- 4. plugin payload is the current source plugin -------------------
    foreach ($relative in @('package.json', 'cordis.patch.yml', 'lib\index.js', 'lib\core.js', 'lib\client.js')) {
        $left = (Get-FileHash -LiteralPath (Join-Path $root $relative) -Algorithm SHA256).Hash
        $right = (Get-FileHash -LiteralPath (Join-Path $stage ('plugin\' + $relative)) -Algorithm SHA256).Hash
        Assert-True ($left -eq $right) ('plugin payload matches project source: ' + $relative)
    }
    $manifest = [IO.File]::ReadAllText((Join-Path $stage 'plugin\package.json')) | ConvertFrom-Json
    Assert-True ($manifest.name -eq 'dsh-token-usage') 'plugin package name is dsh-token-usage'
    Assert-True (-not $manifest.dependencies -or @($manifest.dependencies.PSObject.Properties).Count -eq 0) 'plugin has no external runtime dependencies'
    Assert-True (Test-Path -LiteralPath (Join-Path $stage 'plugin\lib\client.js') -PathType Leaf) 'prebuilt client bundle is present'

    # --- 5. launchers and instruction text --------------------------------
    foreach ($name in @($installCmd, $uninstallCmd, $checkCmd)) {
        $bytes = [IO.File]::ReadAllBytes((Join-Path $stage $name))
        Assert-True (@($bytes | Where-Object { $_ -gt 127 }).Count -eq 0) ($name + ' is ASCII')
        $crlf = $true
        for ($i = 0; $i -lt $bytes.Length; $i++) { if ($bytes[$i] -eq 10 -and ($i -eq 0 -or $bytes[$i-1] -ne 13)) { $crlf = $false } }
        Assert-True $crlf ($name + ' uses CRLF')
    }
    $txtBytes = [IO.File]::ReadAllBytes((Join-Path $stage $txt))
    Assert-True (-not ($txtBytes.Length -ge 3 -and $txtBytes[0] -eq 0xEF -and $txtBytes[1] -eq 0xBB -and $txtBytes[2] -eq 0xBF)) ($txt + ' has no BOM')
    $txtText = [Text.Encoding]::UTF8.GetString($txtBytes)
    Assert-True ($txtText.Contains('dsh-token-usage')) ($txt + ' documents the plugin name')
    Assert-True ($txtText.Contains(([string][char]0x5B89 + [char]0x88C5))) ($txt + ' is readable UTF-8 Chinese')
    $ps1Text = [IO.File]::ReadAllText((Join-Path $stage 'tools\portable.ps1'))
    Assert-True (-not $ps1Text.Contains('dsh-multi-workspace')) 'portable.ps1 targets dsh-token-usage only'

    # --- 6. smoke install from the extracted release ----------------------
    if (-not $SkipFakeMachine) {
        $fixture = Join-Path $work 'fake machine'
        $fakeHome = Join-Path $fixture '.dsh'
        $profileDir = Join-Path $fakeHome 'profiles\desktop'
        New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $profileDir 'package.json'), '{"name":"profile-test","private":true,"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","other-plugin"]}},"dependencies":{"other-plugin":"link:D:/unrelated"}}', $utf8)
        [IO.File]::WriteAllText((Join-Path $profileDir 'cordis.patch.yml'), "# unrelated patch`n", $utf8)
        $fakeCli = Join-Path $fixture 'fake dsh.ps1'
        $mock = @'
$ErrorActionPreference = 'Stop'
if ($args -notcontains '--offline' -or $args -notcontains '--ignore-scripts') { throw 'offline flags missing' }
if ($env:npm_config_offline -ne 'true' -or $env:npm_config_ignore_scripts -ne 'true') { throw 'offline environment missing' }
$i = [Array]::IndexOf($args, '--profile')
$profile = $args[$i + 1]
$op = $args[$i + 2]
$value = $args[$i + 3]
$dir = Join-Path $env:DSH_HOME ('profiles\' + $profile)
$path = Join-Path $dir 'package.json'
$manifest = [IO.File]::ReadAllText($path) | ConvertFrom-Json
$name = 'dsh-token-usage'
$link = Join-Path $dir ('node_modules\' + $name)
if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link -Recurse -Force }
if ($op -eq 'add') {
    $target = $value.Substring('link:'.Length)
    if (-not $manifest.dependencies) { $manifest | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
    $manifest.dependencies | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force
    if (@($manifest.dsh.profile.bundles) -notcontains $name) { $manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles) + $name }
    New-Item -ItemType Directory -Path (Split-Path -Parent $link) -Force | Out-Null
    Copy-Item -LiteralPath $target -Destination $link -Recurse
} elseif ($op -eq 'remove') {
    $manifest.dependencies.PSObject.Properties.Remove($name)
    $manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne $name })
} else { throw ('unknown operation ' + $op) }
[IO.File]::WriteAllText($path, ($manifest | ConvertTo-Json -Depth 50), (New-Object Text.UTF8Encoding($false)))
$global:LASTEXITCODE = 0
'@
        [IO.File]::WriteAllText($fakeCli, $mock, $utf8)
        $ps = Join-Path $stage 'tools\portable.ps1'
        # The real DSH desktop may be running on this machine, and the shipped
        # installer refuses to touch a live install. Drive the shipped script
        # through a thin harness that only stubs the process probe; everything
        # else (validation, copy, CLI call, backup, rollback) is the real code.
        $driver = Join-Path $fixture 'run-portable.ps1'
        $driverTemplate = @'
param([string]$RunMode, [string]$Cli, [string]$DataHome, [string]$ProfileName, [string]$SourceRoot, [string]$PortablePath)
$ErrorActionPreference = 'Stop'
. $PortablePath -Library
function Get-TkuDshProcesses { return @() }
Invoke-TkuDeployment -Mode $RunMode -DshPath $Cli -DshHome $DataHome -Profile $ProfileName -PluginSource $SourceRoot | Out-Null
'@
        [IO.File]::WriteAllText($driver, $driverTemplate, $utf8)
        $pluginSource = Join-Path $stage 'plugin'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $driver -RunMode Install -Cli $fakeCli -DataHome $fakeHome -ProfileName desktop -SourceRoot $pluginSource -PortablePath $ps | Out-Host
        Assert-True ($LASTEXITCODE -eq 0) 'smoke install from extracted ZIP exits 0'
        $installedManifest = [IO.File]::ReadAllText((Join-Path $profileDir 'package.json')) | ConvertFrom-Json
        Assert-True ($installedManifest.dependencies.'dsh-token-usage' -like 'link:*') 'registration contains the plugin link'
        Assert-True (@($installedManifest.dsh.profile.bundles) -contains 'dsh-token-usage') 'registration contains the bundle'
        Assert-True ($installedManifest.dependencies.'other-plugin' -eq 'link:D:/unrelated') 'unrelated dependency is preserved'
        Assert-True (Test-Path -LiteralPath (Join-Path $fakeHome 'custom-plugins\dsh-token-usage\desktop\lib\client.js') -PathType Leaf) 'plugin files were copied to the stable directory'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $driver -RunMode Uninstall -Cli $fakeCli -DataHome $fakeHome -ProfileName desktop -SourceRoot $pluginSource -PortablePath $ps | Out-Host
        Assert-True ($LASTEXITCODE -eq 0) 'smoke uninstall from extracted ZIP exits 0'
        $after = [IO.File]::ReadAllText((Join-Path $profileDir 'package.json')) | ConvertFrom-Json
        Assert-True (@($after.dsh.profile.bundles) -notcontains 'dsh-token-usage') 'uninstall removed the bundle registration'
        Assert-True ($after.dependencies.'other-plugin' -eq 'link:D:/unrelated') 'uninstall preserved unrelated settings'
    }
    Write-Host ''
    Write-Host ('Release verification passed: ' + $script:checks + ' checks. Real DSH profile was not modified.')
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
