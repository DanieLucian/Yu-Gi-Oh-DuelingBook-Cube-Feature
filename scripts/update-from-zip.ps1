# Update the unpacked extension from a downloaded GitHub ZIP. PowerShell 5.1+.
# This updater installs the tested v0.4.6 runtime, not an arbitrary ZIP.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $TargetDirectory,
    [string] $ArchivePath
)

$ErrorActionPreference = 'Stop'
$expectedName = 'DuelingBook Cube Draft (Prototype)'
$hashes = [ordered]@{
    'manifest.json' = '01a94cd49f6f60cd547cea3fc1568f49f50b3598ac7e5ca22909fde2842f2917'
    'content.js' = 'a2ea18e1c58ed60564cfb582fd238c8c55580027738ab2eb81cfd0a17855a437'
    'popup.html' = '6504bcef2029d9ceb9b88fe0313e953b5996629a89bddde8cf008bd9f925e679'
    'popup.css' = '3c5b1fa6810525b747043816408718b41c70956725cba7277a239fa398f6adc5'
    'popup.js' = '0a84431ce13caeafe97638bb296498a4ed6915409fa1769c92a13d22eedffbaf'
}

if (-not (Test-Path -LiteralPath $TargetDirectory -PathType Container)) {
    throw 'The target directory does not exist. Choose the folder currently loaded in Chrome.'
}
$target = (Get-Item -LiteralPath $TargetDirectory).FullName
$targetManifest = Join-Path $target 'manifest.json'
if (-not (Test-Path -LiteralPath $targetManifest -PathType Leaf)) {
    throw 'No manifest.json in the target folder. Choose the actual extension directory.'
}
$current = Get-Content -LiteralPath $targetManifest -Raw | ConvertFrom-Json
if ($current.name -ne $expectedName) {
    throw 'The target folder contains a different extension. No files were changed.'
}

if (-not $ArchivePath) {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = 'Select the downloaded DuelingBook Cube Draft ZIP'
    $picker.Filter = 'ZIP archives (*.zip)|*.zip'
    try {
        if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }
        $ArchivePath = $picker.FileName
    } finally { $picker.Dispose() }
}
$archive = (Get-Item -LiteralPath $ArchivePath).FullName
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ('dbcd-update-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    Expand-Archive -LiteralPath $archive -DestinationPath $staging
    $manifests = @(Get-ChildItem -LiteralPath $staging -Filter 'manifest.json' -File -Recurse)
    if ($manifests.Count -ne 1) {
        throw 'Expected one extension manifest inside the ZIP. No files were changed.'
    }
    $source = $manifests[0].Directory.FullName
    foreach ($name in $hashes.Keys) {
        $sourceFile = Join-Path $source $name
        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
            throw ('Missing file in ZIP: ' + $name + '. No files were changed.')
        }
        $actual = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
        if ($actual -ne $hashes[$name]) {
            throw ('Unexpected revision or changed file: ' + $name + '. Use the specified v0.4.6 ZIP. No files were changed.')
        }
    }

    # Keep backups next to the extension, not inside Chrome's loaded folder.
    $backup = $target.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + '.backup-' + [guid]::NewGuid().ToString('N')
    New-Item -ItemType Directory -Path $backup | Out-Null
    $originalFiles = @()
    foreach ($name in $hashes.Keys) {
        $existing = Join-Path $target $name
        if (Test-Path -LiteralPath $existing -PathType Leaf) {
            Copy-Item -LiteralPath $existing -Destination (Join-Path $backup $name)
            $originalFiles += $name
        }
    }
    try {
        foreach ($name in $hashes.Keys) {
            Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $target $name) -Force
        }
    } catch {
        $updateError = $_.Exception.Message
        foreach ($name in $hashes.Keys) {
            try {
                if ($originalFiles -contains $name) {
                    Copy-Item -LiteralPath (Join-Path $backup $name) -Destination (Join-Path $target $name) -Force
                } elseif (Test-Path -LiteralPath (Join-Path $target $name) -PathType Leaf) {
                    Remove-Item -LiteralPath (Join-Path $target $name) -Force
                }
            } catch { Write-Warning ('Could not restore ' + $name + ': ' + $_.Exception.Message) }
        }
        throw ('Update failed: ' + $updateError + '. Backup files: ' + $backup)
    }
    Write-Host ('Updated extension files in: ' + $target)
    Write-Host ('Previous files backed up in: ' + $backup)
    Write-Host 'Click Reload for the extension in chrome://extensions, then refresh the DuelingBook tab.'
} finally {
    Remove-Item -LiteralPath $staging -Recurse -Force
}
