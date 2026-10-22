#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Install', 'Uninstall', 'Check')][string]$Mode = 'Check',
    [string]$DshPath,
    [string]$DshHome,
    [string]$Profile = 'desktop',
    [string]$PluginSource,
    [switch]$Library
)

$ErrorActionPreference = 'Stop'
$script:TkuPackageName = 'dsh-token-usage'
$script:TkuMetadataNames = @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'cordis.yml', 'compatibility.json')

function Read-TkuJson([string]$Path) {
    return ([IO.File]::ReadAllText($Path) | ConvertFrom-Json)
}

function Write-TkuUtf8([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

function Get-TkuAbsolutePath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'An empty path is not allowed.' }
    return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Assert-TkuChildPath([string]$Path, [string]$Root) {
    $fullPath = Get-TkuAbsolutePath $Path
    $fullRoot = Get-TkuAbsolutePath $Root
    $prefix = $fullRoot + [IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw ('Refusing a file operation outside the expected directory: ' + $fullPath)
    }
    return $fullPath
}

function Test-TkuReparsePoint([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    return ($null -ne $item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0))
}

function Assert-TkuNoLinkedAncestors([string]$Path, [string]$Root) {
    $current = Get-TkuAbsolutePath $Path
    $boundary = Get-TkuAbsolutePath $Root
    if ($current -ne $boundary) { $null = Assert-TkuChildPath $current $boundary }
    while ($true) {
        if (Test-TkuReparsePoint $current) { throw ('A managed directory is a reparse point: ' + $current) }
        if ($current.Equals($boundary, [StringComparison]::OrdinalIgnoreCase)) { break }
        $current = Split-Path -Parent $current
        if (-not $current) { throw 'Cannot verify the managed directory boundary.' }
    }
}

function Assert-TkuTreeNoLinks([string]$Path) {
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($Path)
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        if (Test-TkuReparsePoint $directory) { throw ('A managed directory is a reparse point: ' + $directory) }
        foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force)) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('A managed directory contains a reparse point: ' + $item.FullName) }
            if ($item.PSIsContainer) { $pending.Push($item.FullName) }
        }
    }
}

function Remove-TkuOwnedDirectory([string]$Path, [string]$Root) {
    $checked = Assert-TkuChildPath $Path $Root
    if (-not (Test-Path -LiteralPath $checked)) { return }
    Assert-TkuNoLinkedAncestors $checked $Root
    Assert-TkuTreeNoLinks $checked
    Remove-Item -LiteralPath $checked -Recurse -Force
}

function Get-TkuDshProcesses {
    return @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
}

function Get-TkuUserProfile {
    $value = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    if ([string]::IsNullOrWhiteSpace($value)) { $value = $env:USERPROFILE }
    if ([string]::IsNullOrWhiteSpace($value)) { throw 'Cannot determine the current Windows user directory.' }
    return Get-TkuAbsolutePath $value
}

function Find-TkuDshCli([string]$RequestedPath) {
    $candidates = New-Object 'System.Collections.Generic.List[string]'
    if ($RequestedPath) {
        $requested = Get-TkuAbsolutePath $RequestedPath
        if (Test-Path -LiteralPath $requested -PathType Container) {
            $requested = Join-Path $requested 'resources\runtime\cli\bin\dsh.cmd'
        }
        if (-not (Test-Path -LiteralPath $requested -PathType Leaf)) { throw ('DSH CLI was not found at: ' + $requested) }
        return $requested
    }
    $userRoot = Get-TkuUserProfile
    $localRoots = @((Join-Path $userRoot 'AppData\Local'), $env:LOCALAPPDATA)
    foreach ($localRoot in $localRoots) {
        if ($localRoot) { $candidates.Add((Join-Path $localRoot 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')) }
    }
    foreach ($programRoot in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($programRoot) { $candidates.Add((Join-Path $programRoot 'DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')) }
    }
    foreach ($registryRoot in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
        try {
            foreach ($entry in @(Get-ItemProperty -Path $registryRoot -ErrorAction SilentlyContinue)) {
                if ($entry.DisplayName -like '*DeepSeek Harness*' -and $entry.InstallLocation) {
                    $candidates.Add((Join-Path $entry.InstallLocation 'resources\runtime\cli\bin\dsh.cmd'))
                }
            }
        } catch { }
    }
    foreach ($process in @(Get-TkuDshProcesses)) {
        try {
            if ($process.Path) { $candidates.Add((Join-Path (Split-Path -Parent $process.Path) 'resources\runtime\cli\bin\dsh.cmd')) }
        } catch { }
    }
    $command = Get-Command dsh.cmd -ErrorAction SilentlyContinue
    if ($command -and $command.Source) { $candidates.Add($command.Source) }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return Get-TkuAbsolutePath $candidate }
    }
    throw 'DSH Desktop was not found. Start it once, or run portable.ps1 with -DshPath <DSH installation directory>.'
}

function Get-TkuEnvironment([string]$RequestedDshPath, [string]$RequestedHome, [string]$ProfileName, [string]$Source) {
    if ($ProfileName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or $ProfileName -eq '.' -or $ProfileName -eq '..') {
        throw 'The profile name may contain letters, numbers, dot, underscore and hyphen; path components are not allowed.'
    }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'This release supports Windows x64 only.' }
    $cli = Find-TkuDshCli $RequestedDshPath
    $resolvedHome = $RequestedHome
    if (-not $resolvedHome) { $resolvedHome = $env:DSH_HOME }
    if (-not $resolvedHome) { $resolvedHome = Join-Path (Get-TkuUserProfile) '.dsh' }
    $resolvedHome = Get-TkuAbsolutePath $resolvedHome
    $profileDir = Assert-TkuChildPath (Join-Path $resolvedHome ('profiles\' + $ProfileName)) $resolvedHome
    $manifestPath = Join-Path $profileDir 'package.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw ('The DSH profile is not initialized: ' + $profileDir + '. Open DSH Desktop once before installing.')
    }
    $manifest = Read-TkuJson $manifestPath
    if (-not $manifest.dsh -or -not $manifest.dsh.profile) { throw ('Not a DSH profile: ' + $profileDir) }
    if (-not $Source) {
        $packageRoot = Split-Path -Parent $PSScriptRoot
        if (Test-Path -LiteralPath (Join-Path $packageRoot 'plugin\package.json')) { $Source = Join-Path $packageRoot 'plugin' }
        else { $Source = $packageRoot }
    }
    $Source = Get-TkuAbsolutePath $Source
    $pluginRoot = Assert-TkuChildPath (Join-Path $resolvedHome ('custom-plugins\' + $script:TkuPackageName)) $resolvedHome
    $installDir = Assert-TkuChildPath (Join-Path $pluginRoot $ProfileName) $pluginRoot
    Assert-TkuNoLinkedAncestors $profileDir $resolvedHome
    Assert-TkuNoLinkedAncestors (Join-Path $profileDir 'node_modules') $resolvedHome
    Assert-TkuNoLinkedAncestors $installDir $resolvedHome
    return [pscustomobject]@{ Cli = $cli; Home = $resolvedHome; Profile = $ProfileName; ProfileDir = $profileDir; Manifest = $manifestPath; Source = $Source; PluginRoot = $pluginRoot; InstallDir = $installDir; NodeLink = (Join-Path $profileDir ('node_modules\' + $script:TkuPackageName)) }
}

function Invoke-TkuCli($Environment, [string[]]$Arguments) {
    $processValues = @{
        DSH_HOME = $Environment.Home
        npm_config_offline = 'true'
        npm_config_ignore_scripts = 'true'
    }
    $previousValues = @{}
    foreach ($key in $processValues.Keys) { $previousValues[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
    try {
        # DSH may run a compatibility-repair pnpm subprocess without forwarding
        # the original command-line flags. Config environment reaches it too.
        foreach ($key in $processValues.Keys) { [Environment]::SetEnvironmentVariable($key, $processValues[$key], 'Process') }
        $global:LASTEXITCODE = 0
        & $Environment.Cli @Arguments | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) { throw ('DSH CLI failed with exit code ' + $LASTEXITCODE + '.') }
    } finally {
        foreach ($key in $processValues.Keys) { [Environment]::SetEnvironmentVariable($key, $previousValues[$key], 'Process') }
    }
}

function ConvertTo-TkuCanonicalValue($Value) {
    if ($null -eq $Value -or $Value -is [string] -or $Value -is [ValueType]) { return $Value }
    if ($Value -is [Collections.IDictionary]) {
        $ordered = [ordered]@{}
        foreach ($key in @($Value.Keys | Sort-Object)) { $ordered[$key] = ConvertTo-TkuCanonicalValue $Value[$key] }
        return [pscustomobject]$ordered
    }
    if ($Value -is [Collections.IEnumerable]) {
        $items = New-Object 'System.Collections.Generic.List[object]'
        foreach ($item in $Value) { $items.Add((ConvertTo-TkuCanonicalValue $item)) }
        return ,($items.ToArray())
    }
    $ordered = [ordered]@{}
    foreach ($property in @($Value.PSObject.Properties | Sort-Object Name)) {
        $ordered[$property.Name] = ConvertTo-TkuCanonicalValue $property.Value
    }
    return [pscustomobject]$ordered
}

function Get-TkuOtherManifestState($Manifest) {
    $copy = ($Manifest | ConvertTo-Json -Depth 100 | ConvertFrom-Json)
    if ($copy.dependencies) { $copy.dependencies.PSObject.Properties.Remove($script:TkuPackageName) }
    if ($copy.dsh -and $copy.dsh.profile) {
        $copy.dsh.profile.bundles = @($copy.dsh.profile.bundles | Where-Object { $_ -ne $script:TkuPackageName })
    }
    # pnpm may add/update its own packageManager annotation.
    $copy.PSObject.Properties.Remove('packageManager')
    if ($copy.dependencies -and @($copy.dependencies.PSObject.Properties).Count -eq 0) { $copy.PSObject.Properties.Remove('dependencies') }
    # Object key order is not semantic; array order remains significant.
    return ((ConvertTo-TkuCanonicalValue $copy) | ConvertTo-Json -Depth 100 -Compress)
}

function New-TkuBackup($Environment) {
    $backupRoot = Assert-TkuChildPath (Join-Path $Environment.Home ('backups\' + $script:TkuPackageName)) $Environment.Home
    Assert-TkuNoLinkedAncestors $backupRoot $Environment.Home
    $backup = Assert-TkuChildPath (Join-Path $backupRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))) $backupRoot
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $files = @()
    foreach ($name in $script:TkuMetadataNames) {
        $path = Join-Path $Environment.ProfileDir $name
        $exists = Test-Path -LiteralPath $path -PathType Leaf
        $files += [pscustomobject]@{ Name = $name; Existed = $exists }
        if ($exists) { Copy-Item -LiteralPath $path -Destination (Join-Path $backup $name) }
    }
    $oldLink = Get-Item -LiteralPath $Environment.NodeLink -Force -ErrorAction SilentlyContinue
    $link = $null
    if ($oldLink) {
        if (($oldLink.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            $target = @($oldLink.Target)[0]
            if (-not $target) { throw ('Cannot back up the existing plugin link: ' + $Environment.NodeLink) }
            if (-not [IO.Path]::IsPathRooted($target)) { $target = Get-TkuAbsolutePath (Join-Path $oldLink.Parent.FullName $target) }
            $link = [pscustomobject]@{ Kind = 'Link'; Target = $target; Type = $oldLink.LinkType }
        } else {
            Assert-TkuTreeNoLinks $oldLink.FullName
            Copy-Item -LiteralPath $oldLink.FullName -Destination (Join-Path $backup 'node-module-previous') -Recurse
            $link = [pscustomobject]@{ Kind = 'Directory' }
        }
    }
    $record = [pscustomobject]@{ Profile = $Environment.Profile; CreatedAt = (Get-Date).ToString('o'); InstallDir = $Environment.InstallDir; Files = $files; Link = $link }
    Write-TkuUtf8 (Join-Path $backup 'transaction.json') (($record | ConvertTo-Json -Depth 20) + [Environment]::NewLine)
    return [pscustomobject]@{ Directory = $backup; Record = $record; PreviousPluginMoved = $false; NewPluginCopied = $false }
}

function Remove-TkuNodeLink($Environment) {
    $checked = Assert-TkuChildPath $Environment.NodeLink (Join-Path $Environment.ProfileDir 'node_modules')
    $entry = Get-Item -LiteralPath $checked -Force -ErrorAction SilentlyContinue
    if (-not $entry) { return }
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        # Delete only the junction/symlink entry; never recurse into its target.
        [IO.Directory]::Delete($checked, $false)
    } else { Remove-TkuOwnedDirectory $checked (Join-Path $Environment.ProfileDir 'node_modules') }
}

function Restore-TkuBackup($Environment, $Backup) {
    foreach ($file in $Backup.Record.Files) {
        $target = Join-Path $Environment.ProfileDir $file.Name
        if ($file.Existed) { Copy-Item -LiteralPath (Join-Path $Backup.Directory $file.Name) -Destination $target -Force }
        elseif (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
    }
    if ($Backup.NewPluginCopied -and (Test-Path -LiteralPath $Environment.InstallDir)) {
        Remove-TkuOwnedDirectory $Environment.InstallDir $Environment.PluginRoot
    }
    if ($Backup.PreviousPluginMoved) {
        $source = Assert-TkuChildPath (Join-Path $Backup.Directory 'plugin-previous') $Backup.Directory
        $target = Assert-TkuChildPath $Environment.InstallDir $Environment.PluginRoot
        Move-Item -LiteralPath $source -Destination $target
    }
    Remove-TkuNodeLink $Environment
    if ($Backup.Record.Link) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $Environment.NodeLink) -Force | Out-Null
        if ($Backup.Record.Link.Kind -eq 'Link') {
            $kind = if ($Backup.Record.Link.Type -eq 'SymbolicLink') { 'SymbolicLink' } else { 'Junction' }
            New-Item -ItemType $kind -Path $Environment.NodeLink -Target $Backup.Record.Link.Target | Out-Null
        } else {
            Copy-Item -LiteralPath (Join-Path $Backup.Directory 'node-module-previous') -Destination $Environment.NodeLink -Recurse
        }
    }
}

function Assert-TkuPluginSource($Environment) {
    $required = @('package.json', 'cordis.patch.yml', 'lib\index.js', 'lib\client.js')
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $Environment.Source $relative) -PathType Leaf)) { throw ('The plugin package is incomplete: missing ' + $relative) }
    }
    $self = Read-TkuJson (Join-Path $Environment.Source 'package.json')
    if ($self.name -ne $script:TkuPackageName) { throw 'The source package name is not dsh-token-usage.' }
    if ($self.dependencies -and @($self.dependencies.PSObject.Properties).Count -gt 0) { throw 'This portable installer expects a prebuilt plugin with no external runtime dependencies.' }
    $installPrefix = $Environment.InstallDir + [IO.Path]::DirectorySeparatorChar
    $sourcePrefix = $Environment.Source + [IO.Path]::DirectorySeparatorChar
    if ($Environment.Source.Equals($Environment.InstallDir, [StringComparison]::OrdinalIgnoreCase) -or $Environment.Source.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase) -or $Environment.InstallDir.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The release source and target installation must be separate directories.'
    }
    if (Test-TkuReparsePoint $Environment.Source) { throw 'The release source must be an ordinary directory, not a reparse point.' }
    Assert-TkuTreeNoLinks $Environment.Source
    return $self
}

function Invoke-TkuDeployment {
    [CmdletBinding()]
    param([ValidateSet('Install', 'Uninstall', 'Check')][string]$Mode = 'Check', [string]$DshPath, [string]$DshHome, [string]$Profile = 'desktop', [string]$PluginSource)
    $environment = Get-TkuEnvironment $DshPath $DshHome $Profile $PluginSource
    Write-Host ('DSH CLI: ' + $environment.Cli)
    Write-Host ('DSH home: ' + $environment.Home)
    Write-Host ('Profile: ' + $environment.Profile)
    Write-Host ('Stable plugin directory: ' + $environment.InstallDir)
    $manifest = Read-TkuJson $environment.Manifest
    $installed = ($manifest.dependencies -and $manifest.dependencies.PSObject.Properties[$script:TkuPackageName]) -or (@($manifest.dsh.profile.bundles) -contains $script:TkuPackageName)
    $running = @(Get-TkuDshProcesses)
    if ($Mode -eq 'Check') {
        $self = Assert-TkuPluginSource $environment
        Write-Host ('Release: ' + $self.name + ' ' + $self.version)
        Write-Host ('Currently registered: ' + [bool]$installed)
        Write-Host ('DSH Desktop processes: ' + $running.Count)
        if ($running.Count) { Write-Host 'Close DSH completely before installation or removal.' }
        Write-Host 'Check complete. No files or settings were changed.'
        return $environment
    }
    if ($running.Count -gt 0) { throw 'DSH Desktop is running. Completely exit it, including the tray icon, and run this action again.' }
    if ($Mode -eq 'Uninstall' -and -not $installed) {
        Write-Host 'The plugin is not registered in this profile. No changes were made.'
        return $environment
    }
    if ($Mode -eq 'Install') { $self = Assert-TkuPluginSource $environment }
    if (Test-TkuReparsePoint $environment.PluginRoot) { throw 'The plugin installation root is a reparse point; choose an ordinary DSH home directory.' }
    if (Test-TkuReparsePoint $environment.InstallDir) { throw 'The plugin installation directory is a reparse point; remove it before installing.' }
    $otherBefore = Get-TkuOtherManifestState $manifest
    $backup = New-TkuBackup $environment
    Write-Host ('Transaction backup: ' + $backup.Directory)
    try {
        if ($Mode -eq 'Install') {
            New-Item -ItemType Directory -Path $environment.PluginRoot -Force | Out-Null
            if (Test-Path -LiteralPath $environment.InstallDir) {
                $old = Assert-TkuChildPath $environment.InstallDir $environment.PluginRoot
                $backupTarget = Assert-TkuChildPath (Join-Path $backup.Directory 'plugin-previous') $backup.Directory
                Move-Item -LiteralPath $old -Destination $backupTarget
                $backup.PreviousPluginMoved = $true
            }
            $backup.NewPluginCopied = $true
            Copy-Item -LiteralPath $environment.Source -Destination $environment.InstallDir -Recurse
            $spec = 'link:' + $environment.InstallDir.Replace('\', '/')
            Invoke-TkuCli $environment @('plugin', '--profile', $environment.Profile, 'add', $spec, '--offline', '--ignore-scripts')
            $after = Read-TkuJson $environment.Manifest
            if (-not $after.dependencies -or -not $after.dependencies.PSObject.Properties[$script:TkuPackageName] -or @($after.dsh.profile.bundles) -notcontains $script:TkuPackageName) {
                throw 'DSH did not register both the plugin dependency and bundle.'
            }
            $registered = Read-TkuJson (Join-Path $environment.NodeLink 'package.json')
            if ($registered.name -ne $script:TkuPackageName -or $registered.version -ne $self.version) { throw 'The installed package could not be verified through the profile link.' }
        } else {
            Invoke-TkuCli $environment @('plugin', '--profile', $environment.Profile, 'remove', $script:TkuPackageName, '--offline', '--ignore-scripts')
            $after = Read-TkuJson $environment.Manifest
            if (($after.dependencies -and $after.dependencies.PSObject.Properties[$script:TkuPackageName]) -or @($after.dsh.profile.bundles) -contains $script:TkuPackageName) { throw 'DSH did not remove the plugin registration.' }
        }
        if ((Get-TkuOtherManifestState $after) -ne $otherBefore) { throw 'An unrelated profile setting changed during installation; rolling back this transaction.' }
        $patchBefore = Join-Path $backup.Directory 'cordis.patch.yml'
        $patchNow = Join-Path $environment.ProfileDir 'cordis.patch.yml'
        if ((Test-Path -LiteralPath $patchBefore) -and ([IO.File]::ReadAllText($patchBefore) -ne [IO.File]::ReadAllText($patchNow))) { throw 'The user patch unexpectedly changed; rolling back this transaction.' }
        if ($Mode -eq 'Uninstall' -and (Test-Path -LiteralPath $environment.InstallDir)) {
            $old = Assert-TkuChildPath $environment.InstallDir $environment.PluginRoot
            $backupTarget = Assert-TkuChildPath (Join-Path $backup.Directory 'plugin-previous') $backup.Directory
            Move-Item -LiteralPath $old -Destination $backupTarget
            $backup.PreviousPluginMoved = $true
        }
        Write-TkuUtf8 (Join-Path $backup.Directory 'result.txt') ($Mode + ' succeeded. This backup is retained for recovery.' + [Environment]::NewLine)
        Write-Host ($Mode + ' complete. Start DSH Desktop again.')
        return $environment
    } catch {
        $failure = $_
        try {
            Restore-TkuBackup $environment $backup
            Write-Host 'The failed transaction was rolled back. Other plugin settings were preserved.'
        } catch {
            throw ('Deployment failed: ' + $failure.Exception.Message + ' Automatic rollback also failed: ' + $_.Exception.Message + ' Backup: ' + $backup.Directory)
        }
        throw ('Deployment failed and was rolled back: ' + $failure.Exception.Message + ' No online fallback was attempted. Backup: ' + $backup.Directory)
    }
}

if (-not $Library) {
    try {
        Invoke-TkuDeployment -Mode $Mode -DshPath $DshPath -DshHome $DshHome -Profile $Profile -PluginSource $PluginSource | Out-Null
    } catch {
        Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red
        exit 1
    }
}
