# Update an unpacked extension on Windows

The helper `extension/scripts/update-from-zip.ps1` installs the built v0.4.7
extension runtime. It updates a dedicated unpacked extension directory in place
so Chrome continues to use the same extension registration and storage.

1. Download the inner `duelingbook-extension.zip` from the **chrome-web-store**
   workflow artifact, or [build it locally](../README.md).
2. Save `extension/scripts/update-from-zip.ps1` as `update-from-zip.ps1` in Downloads.
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

When updating from v0.4.6 or earlier, download the new updater as well as the ZIP and
replace the older updater file in Downloads. Older updater checksums deliberately
reject the new runtime files. Confirm **Prototype v0.4.7** in the popup after
reloading the extension and refreshing DuelingBook.

Scan your Cube decks again and export a fresh Cube JSON to include Spell/Trap
subtypes in the drafting renderer. Saved copies and sections are preserved.
