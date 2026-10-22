#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [string]$PackageRoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'portable.ps1') -Library

$script:TkuReleaseName = 'dsh-token-usage'
# Fixed portable package layout. Only these plugin entries may be shipped.
$script:TkuAllowedPluginEntries = @('package.json', 'cordis.patch.yml', 'lib')
$script:TkuRequiredPluginFiles = @('package.json', 'cordis.patch.yml', 'lib\index.js', 'lib\client.js', 'lib\core.js')
# Delivery file names are built from code points so this script stays pure ASCII.
# Windows PowerShell 5.1 reads BOM-less scripts as ANSI; Chinese literals would corrupt.
$script:TkuDeliveryTxt = ([string][char]0x4F7F) + [char]0x7528 + [char]0x8BF4 + [char]0x660E + '.txt'   # instruction txt
$script:TkuInstallCmd = ([string][char]0x5B89) + [char]0x88C5 + '.cmd'                                   # install cmd
$script:TkuUninstallCmd = ([string][char]0x5378) + [char]0x8F7D + '.cmd'                                 # uninstall cmd
$script:TkuCheckCmd = ([string][char]0x68C0) + [char]0x67E5 + [char]0x73AF + [char]0x5883 + '.cmd'       # check cmd

function ConvertTo-TkuCmdLauncher([string]$SourcePath, [string]$DestinationPath) {
    $bytes = [IO.File]::ReadAllBytes($SourcePath)
    if (@($bytes | Where-Object { $_ -gt 127 }).Count) { throw ('A CMD launcher contains non-ASCII bytes: ' + [IO.Path]::GetFileName($SourcePath)) }
    $text = [Text.Encoding]::ASCII.GetString($bytes).Replace("`r`n", "`n").Replace("`r", "`n")
    $text = $text.Replace("`n", "`r`n")
    if (-not $text.EndsWith("`r`n")) { $text += "`r`n" }
    [IO.File]::WriteAllText($DestinationPath, $text, [Text.Encoding]::ASCII)
    $staged = [IO.File]::ReadAllBytes($DestinationPath)
    if (@($staged | Where-Object { $_ -gt 127 }).Count) { throw ('A staged CMD launcher is not ASCII: ' + [IO.Path]::GetFileName($DestinationPath)) }
    for ($index = 0; $index -lt $staged.Length; $index++) {
        if ($staged[$index] -eq 10 -and ($index -eq 0 -or $staged[$index - 1] -ne 13)) {
            throw ('A staged CMD launcher does not use CRLF line endings: ' + [IO.Path]::GetFileName($DestinationPath))
        }
    }
}

if ([string]::IsNullOrWhiteSpace($PackageRoot)) { $PackageRoot = Split-Path -Parent $PSScriptRoot }
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Split-Path -Parent $PackageRoot }
$PackageRoot = Get-TkuAbsolutePath $PackageRoot
$OutputDirectory = Get-TkuAbsolutePath $OutputDirectory
$manifest = Read-TkuJson (Join-Path $PackageRoot 'package.json')
if ($manifest.name -ne $script:TkuReleaseName) { throw 'This script packages dsh-token-usage only.' }
if ($manifest.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'The package version is not a portable release filename.' }
if ($manifest.dependencies -and @($manifest.dependencies.PSObject.Properties).Count -gt 0) { throw 'A portable release must not require external runtime npm dependencies.' }

foreach ($required in $script:TkuRequiredPluginFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $PackageRoot $required) -PathType Leaf)) { throw ('Missing release file: ' + $required) }
}

# package.json "files" is advisory here: the portable ZIP layout is fixed.
# Every declaration must still resolve to an allowlisted top-level entry.
$pluginEntries = @($script:TkuAllowedPluginEntries)
if ($manifest.files) {
    foreach ($declared in @($manifest.files)) {
        if ([IO.Path]::IsPathRooted($declared) -or $declared -match '(^|[\\/])\.\.([\\/]|$)') { throw ('Unsupported release file declaration: ' + $declared) }
        $topLevel = ($declared -split '[\\/]')[0]
        if ($topLevel -match '[*?]') { throw ('Unsupported release file declaration: ' + $declared) }
        if ($script:TkuAllowedPluginEntries -notcontains $topLevel) { throw ('Release file declaration is outside the portable layout: ' + $declared) }
    }
}

$deliveryRoot = Join-Path $PackageRoot 'delivery'
$deliveryRequired = @($script:TkuDeliveryTxt, $script:TkuInstallCmd, $script:TkuUninstallCmd, $script:TkuCheckCmd)
foreach ($name in $deliveryRequired) {
    if (-not (Test-Path -LiteralPath (Join-Path $deliveryRoot $name) -PathType Leaf)) { throw ('Missing delivery file: ' + $name) }
}
foreach ($entry in @(Get-ChildItem -LiteralPath $deliveryRoot -File)) {
    if ($deliveryRequired -notcontains $entry.Name) { throw ('Unexpected delivery file: ' + $entry.Name) }
}

$outputRoot = Join-Path $PackageRoot 'tools\out'
Assert-TkuNoLinkedAncestors $outputRoot $PackageRoot
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$stage = Assert-TkuChildPath (Join-Path $outputRoot ('release-' + [Guid]::NewGuid().ToString('N'))) $outputRoot
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    $pluginDir = Join-Path $stage 'plugin'
    New-Item -ItemType Directory -Path $pluginDir | Out-Null
    foreach ($relative in $pluginEntries) {
        $source = Assert-TkuChildPath (Join-Path $PackageRoot $relative) $PackageRoot
        if (-not (Test-Path -LiteralPath $source)) { continue }
        if (Test-Path -LiteralPath $source -PathType Container) { Assert-TkuTreeNoLinks $source }
        elseif (Test-TkuReparsePoint $source) { throw ('A release file is a reparse point: ' + $source) }
        $destination = Assert-TkuChildPath (Join-Path $pluginDir $relative) $pluginDir
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Recurse
    }

    $toolsDir = Join-Path $stage 'tools'
    New-Item -ItemType Directory -Path $toolsDir | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'portable.ps1') -Destination (Join-Path $toolsDir 'portable.ps1')

    foreach ($entry in @(Get-ChildItem -LiteralPath $deliveryRoot -File)) {
        $destination = Join-Path $stage $entry.Name
        if ($entry.Extension -eq '.cmd') { ConvertTo-TkuCmdLauncher $entry.FullName $destination }
        else { Copy-Item -LiteralPath $entry.FullName -Destination $destination }
    }

    $requiredEntries = @(
        'plugin/package.json',
        'plugin/cordis.patch.yml',
        'plugin/lib/index.js',
        'plugin/lib/core.js',
        'plugin/lib/client.js',
        'tools/portable.ps1'
    ) + $deliveryRequired
    foreach ($entryName in $requiredEntries) {
        if (-not (Test-Path -LiteralPath (Join-Path $stage $entryName))) { throw ('Staged release is incomplete: missing ' + $entryName) }
    }

    $hashLines = @(Get-ChildItem -LiteralPath $stage -File -Recurse | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
        (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $relative
    })
    Write-TkuUtf8 (Join-Path $stage 'SHA256SUMS.txt') (($hashLines -join "`n") + "`n")

    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $zipPath = Join-Path $OutputDirectory ($manifest.name + '-' + $manifest.version + '-win-x64.zip')
    if (Test-Path -LiteralPath $zipPath) { throw ('A release with this name already exists. Choose a new version or output directory: ' + $zipPath) }

    $expectedEntries = @(Get-ChildItem -LiteralPath $stage -File -Recurse | ForEach-Object { $_.FullName.Substring($stage.Length + 1).Replace('\', '/') })
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    # .NET Framework's CreateFromDirectory can emit Windows backslashes in
    # entry names. Build each portable ZIP entry with an explicit slash path.
    $zipStream = [IO.File]::Open($zipPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $zipWriter = New-Object IO.Compression.ZipArchive($zipStream, [IO.Compression.ZipArchiveMode]::Create, $false)
        try {
            foreach ($file in @(Get-ChildItem -LiteralPath $stage -File -Recurse | Sort-Object FullName)) {
                $entryName = $file.FullName.Substring($stage.Length + 1).Replace('\', '/')
                $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipWriter, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal)
            }
        } finally { $zipWriter.Dispose() }
    } finally { $zipStream.Dispose() }

    try {
        $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
        try {
            $names = @($archive.Entries | ForEach-Object { $_.FullName })
            if (@($names | Where-Object { $_.Contains('\') }).Count) { throw 'ZIP verification failed; entry names must use forward slashes.' }
            foreach ($required in $requiredEntries) { if ($names -notcontains $required) { throw ('ZIP verification failed; missing: ' + $required) } }
            foreach ($name in $names) { if ($expectedEntries -notcontains $name) { throw ('ZIP verification failed; unexpected entry: ' + $name) } }
            foreach ($expected in $expectedEntries) { if ($names -notcontains $expected) { throw ('ZIP verification failed; missing entry: ' + $expected) } }
        } finally { $archive.Dispose() }
    } catch {
        if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
        throw
    }

    $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecar = $zipPath + '.sha256.txt'
    Write-TkuUtf8 $sidecar ($hash + '  ' + [IO.Path]::GetFileName($zipPath) + "`n")
    $size = (Get-Item -LiteralPath $zipPath).Length
    Write-Host ('Package: ' + $zipPath)
    Write-Host ('Version: ' + $manifest.version)
    Write-Host ('Bytes: ' + $size)
    Write-Host ('SHA256: ' + $hash)
    Write-Host 'Checksums: SHA256SUMS.txt (inside the ZIP)'
    Write-Host ('Sidecar: ' + $sidecar)
    [pscustomobject]@{ PackagePath = $zipPath; Sha256 = $hash; Bytes = $size; Sidecar = $sidecar }
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-TkuOwnedDirectory $stage $outputRoot }
}
