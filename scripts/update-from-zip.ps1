# Update the unpacked extension from a downloaded GitHub ZIP. PowerShell 5.1+.
# This updater installs the tested v0.4.2 runtime, not an arbitrary ZIP.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $TargetDirectory,
    [string] $ArchivePath
)

$ErrorActionPreference = 'Stop'
$expectedName = 'DuelingBook Cube Draft (Prototype)'
$hashes = [ordered]@{
    'manifest.json' = 'e03894aec935bb6510c97a2b7fc0f25bef66658669731e5a08cbdde4d2ba402a'
    'content.js' = '3d5f3aeeec205cf269eee1e9dbd086f0348d65040bbfc0312911ce2c46866a34'
    'popup.html' = 'eda624b476c2b1fae0758d84b7b2b69caa6cde3910cdc4096576d235d6c77099'
    'popup.css' = 'b9dae710a2d268acf144421eaa5899dbe7c79736b4bac6127be4f2d3e730a9d3'
    'popup.js' = 'f4f4bc7777bce06bac2b177e40dfc148b391f3ce5b342f5911805016e6924895'
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
            throw ('Unexpected revision or changed file: ' + $name + '. Use the specified v0.4.2 ZIP. No files were changed.')
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
