# Update an unpacked extension on Windows

The helper `scripts/update-from-zip.ps1` installs the tested v0.4 extension runtime
from commit `c513fa8d2ccdbc690037a1991a65d92404cf0aea`. It uses a local ZIP so a
private repository does not require a GitHub token in PowerShell.

1. In your signed-in browser, download that revision's source ZIP from GitHub.
2. Save `scripts/update-from-zip.ps1` as `update-from-zip.ps1` in Downloads.
3. Open Windows PowerShell and run this block, replacing the target path with the
   folder currently loaded as the unpacked extension:

```powershell
$updater = Get-Content -LiteralPath "$env:USERPROFILE\Downloads\update-from-zip.ps1" -Raw
& ([scriptblock]::Create($updater)) -TargetDirectory 'D:\path\to\your\extension'
```

4. Select the downloaded ZIP in the file picker. The helper extracts it, verifies
   all five runtime file SHA-256 hashes before making changes, checks the existing
   extension manifest, backs up the files it replaces in a sibling directory,
   and replaces only `manifest.json`, `content.js`, `popup.html`, `popup.css` and
   `popup.js`. It attempts rollback on a copy failure and reports the backup path.
5. Click Reload in `chrome://extensions`, then refresh the DuelingBook tab.

An optional `-ArchivePath 'D:\path\archive.zip'` parameter skips the file picker.
No administrator rights or system execution-policy changes are needed. The
helper does not delete unrelated extension-folder files or access Chrome profile
storage. Export your Cube from Chrome if you want a separate collection backup.
The checksums intentionally reject other revisions; revise them when preparing
a future extension update.
