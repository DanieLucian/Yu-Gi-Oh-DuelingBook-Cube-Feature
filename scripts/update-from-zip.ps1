# DuelingBook Cube Draft v0.5.0 updater -- ready to run on Windows.
# Right-click this file and select Run with PowerShell. Select the v0.5.0 ZIP.
# Destination is prefilled; no command-line arguments or admin rights needed.
[CmdletBinding()]
param(
    [string] $TargetDirectory = 'D:\YGO Custom Card Pics\Duelingbook Cube Feature',
    [string] $ArchivePath
)

$ErrorActionPreference = 'Stop'

function Invoke-CubeFileUpdate {
    param([string] $TargetDirectory, [string] $ArchivePath)
    $ErrorActionPreference = 'Stop'
    $expectedName = 'DuelingBook Cube Draft (Prototype)'
    $hashes = [ordered]@{
        'manifest.json' = '5dad9a177cde3c062e260c729946403f543e40d196669e164258089405902c55'
        'content.js' = 'bb208f16d3b9e0688af23d632d25298ecd928cb89e96c1fce1969a478d282b5a'
        'popup.html' = 'fcdae8e5dff8b21a14c1c3b4ccec8c8ed59bf70f4d0e07edc10b1b49656fb8ca'
        'popup.css' = '858e534d1f85b046aa674d861d5dec48e2a3b025ba9fa78990cb73d58b3e8c4e'
        'xml-matching.js' = '67c93c26213c356f699b30ac8849a15e70149a3fb0f6bc0ea1600eac7c9f0076'
        'popup.js' = '448486a628f85f2a04aa510e72c33af4125ff69de90df40ea86e8d84d849962f'
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
            if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
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
                throw ('Unexpected revision or changed file: ' + $name + '. Use the specified v0.5.0 ZIP. No files were changed.')
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
    return [pscustomobject]@{ Target = $target; Backup = $backup }
}

try {
    Add-Type -AssemblyName System.Windows.Forms
    $result = Invoke-CubeFileUpdate -TargetDirectory $TargetDirectory -ArchivePath $ArchivePath
    if ($null -ne $result) {
        $message = "Updated the six extension files in:`r`n" + $result.Target +
            "`r`n`r`nBackup of previous files:`r`n" + $result.Backup +
            "`r`n`r`nNow click Reload in chrome://extensions and refresh your DuelingBook tab."
        [void][System.Windows.Forms.MessageBox]::Show(
            $message, 'DuelingBook Cube Draft v0.5.0 updated',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        )
    }
} catch {
    $message = $_.Exception.Message
    Write-Host $message -ForegroundColor Red
    try {
        [void][System.Windows.Forms.MessageBox]::Show(
            $message, 'DuelingBook Cube Draft update failed',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
    } catch {
        Write-Host 'Press Enter to close.'
        [void](Read-Host)
    }
    exit 1
}
