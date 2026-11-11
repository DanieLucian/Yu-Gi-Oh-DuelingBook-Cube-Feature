"""Generate a single Windows BAT containing literal PowerShell commands.
No companion .ps1, encoded commands, or execution-policy changes are used.
"""
from pathlib import Path

POWERSHELL = r'''
$ErrorActionPreference='Stop';
function Install-Zip([string]$zip,[string]$dest) {
    $dest=[IO.Path]::GetFullPath($dest).TrimEnd([IO.Path]::DirectorySeparatorChar);
    if (!$dest -or $dest -eq [IO.Path]::GetPathRoot($dest).TrimEnd([IO.Path]::DirectorySeparatorChar)) {throw 'A drive root cannot be replaced.'};
    $item=Get-Item -LiteralPath $dest -Force;
    if (!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Choose a normal project folder, not a link or junction.'};
    $exact=@([Environment]::GetFolderPath('UserProfile'),[Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('MyDocuments'),[IO.Path]::GetTempPath(),(Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'));
    $system=@($env:windir,$env:ProgramFiles,${env:ProgramFiles(x86)},[Environment]::GetFolderPath('LocalApplicationData'),[Environment]::GetFolderPath('ApplicationData'),[Environment]::GetFolderPath('CommonApplicationData'));
    foreach($p in $exact) {if($p -and ($dest -eq $p.TrimEnd([IO.Path]::DirectorySeparatorChar) -or $p.TrimEnd([IO.Path]::DirectorySeparatorChar).StartsWith($dest+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase))) {throw 'Choose a project subfolder, not a personal or temporary root folder.'}};
    foreach($p in $system) {if($p) {$p=$p.TrimEnd([IO.Path]::DirectorySeparatorChar); if($dest -eq $p -or $dest.StartsWith($p+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or $p.StartsWith($dest+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'System and application-data folders cannot be replaced.'}}};
    if($env:DBCD_SELF -and [IO.Path]::GetFullPath($env:DBCD_SELF).StartsWith($dest+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'Keep this BAT outside the destination folder, then run it again.'};
    Add-Type -AssemblyName System.IO.Compression.FileSystem;
    $archive=[IO.Compression.ZipFile]::OpenRead($zip);
    try {
        if(!$archive.Entries.Count) {throw 'The ZIP is empty.'};
        foreach($e in $archive.Entries) {
            $n=$e.FullName.Replace('\','/');
            if([IO.Path]::IsPathRooted($n) -or $n.Contains(':') -or ($n.Split('/') -contains '..') -or (($e.ExternalAttributes -shr 16 -band 61440) -eq 40960)) {throw 'The ZIP contains an unsafe path or symbolic link.'};
        };
    } finally {$archive.Dispose()};
    $parent=Split-Path -LiteralPath $dest;
    $stage=Join-Path $parent ('.zip-update-'+[guid]::NewGuid().ToString('N'));
    $backup=$dest+'.backup-'+[guid]::NewGuid().ToString('N');
    try {
        New-Item -ItemType Directory -Path $stage | Out-Null;
        Expand-Archive -LiteralPath $zip -DestinationPath $stage;
        $payload=$stage;
        $top=@(Get-ChildItem -LiteralPath $stage -Force);
        if($top.Count -eq 1 -and $top[0].PSIsContainer -and (Test-Path -LiteralPath (Join-Path $top[0].FullName 'manifest.json') -PathType Leaf)) {$payload=$top[0].FullName};
        Move-Item -LiteralPath $dest -Destination $backup;
        try {[IO.Directory]::Move($payload,$dest)} catch {
            $failure=$_;
            if(Test-Path -LiteralPath $dest) {Remove-Item -LiteralPath $dest -Recurse -Force};
            try {Move-Item -LiteralPath $backup -Destination $dest} catch {throw ('Update failed and automatic restore failed. Your original folder is at '+$backup)};
            throw $failure;
        };
        return $backup;
    } finally {if(Test-Path -LiteralPath $stage) {Remove-Item -LiteralPath $stage -Recurse -Force}};
};
try {
    Add-Type -AssemblyName System.Windows.Forms;
    $owner=New-Object System.Windows.Forms.Form;
    $owner.TopMost=$true; $owner.ShowInTaskbar=$false; $owner.Opacity=0;
    $owner.Show(); $owner.Activate();
    $pick=New-Object System.Windows.Forms.OpenFileDialog;
    $pick.Title='Select the ZIP to extract'; $pick.Filter='ZIP archives (*.zip)|*.zip';
    $folder=New-Object System.Windows.Forms.FolderBrowserDialog;
    $folder.Description='Select the folder to REPLACE. Its old contents will be backed up.';
    try {
        if($pick.ShowDialog($owner) -ne 'OK') {Write-Host 'Canceled. No changes.'; exit 0};
        if($folder.ShowDialog($owner) -ne 'OK') {Write-Host 'Canceled. No changes.'; exit 0};
        $zip=$pick.FileName; $dest=$folder.SelectedPath;
        if([Windows.Forms.MessageBox]::Show($owner,('Replace all contents of '+$dest+'? A backup will be kept beside it.'),'Confirm replacement','YesNo','Warning') -ne 'Yes') {Write-Host 'Canceled. No changes.'; exit 0};
    } finally {$pick.Dispose();$folder.Dispose();$owner.Dispose()};
    $backup=Install-Zip $zip $dest;
    Write-Host ('Updated: '+$dest); Write-Host ('Backup: '+$backup);
    [void][Windows.Forms.MessageBox]::Show(('Finished. Previous folder saved at '+$backup+'. If updating Chrome, click Reload in chrome://extensions and refresh DuelingBook.'),'Folder updated');
} catch {Write-Host ('ERROR: '+$_.Exception.Message) -ForegroundColor Red; exit 1};
'''

def main():
    payload=' '.join(line.strip() for line in POWERSHELL.splitlines() if line.strip())
    assert '"' not in payload and '%' not in payload
    command='"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -STA -Command "'+payload+'"'
    assert len(command)<7800, len(command)
    bat='\n'.join([
        '@echo off','setlocal DisableDelayedExpansion','title Replace folder from ZIP',
        'set "DBCD_SELF=%~f0"','echo Select a ZIP, then a destination folder.',
        'echo Existing contents will be backed up before replacement.','echo.',command,
        'set "DBCD_RESULT=%ERRORLEVEL%"','echo.','pause','exit /b %DBCD_RESULT%',''
    ])
    output=Path(__file__).with_name('Replace-Folder-From-Zip.bat')
    output.write_bytes(bat.replace('\n','\r\n').encode('ascii'))
    print(f'Generated {output.name}; PowerShell command length {len(command)}.')

if __name__=='__main__':
    main()
