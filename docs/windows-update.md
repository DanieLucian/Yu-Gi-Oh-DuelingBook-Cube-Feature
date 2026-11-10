# Update an unpacked extension on Windows

`scripts/update-from-zip.ps1` is a self-contained Windows PowerShell 5.1+ updater
for the tested v0.5.0 runtime. It is preconfigured for this project's local folder:

```text
D:\YGO Custom Card Pics\Duelingbook Cube Feature
```

No command-line arguments or pasted PowerShell commands are required.

1. Sign in to GitHub in your browser and download the v0.5 source ZIP. Since the
   repository is private, browser sign-in is needed; the updater itself does not
   request a GitHub token or download anything over the network.
2. Open `scripts/update-from-zip.ps1` on GitHub and click **Download raw file**
   (the download-arrow button). Save the actual `.ps1` file, not the HTML page.
3. Right-click the saved `.ps1` and choose **Run with PowerShell**.
4. Select the downloaded ZIP in the file picker. A completion dialog shows the
   updated target folder and the backup location. Canceling makes no changes;
   errors are shown in a dialog instead of disappearing with the console window.
5. Click **Reload** in `chrome://extensions`, then refresh DuelingBook. Confirm
   **Prototype v0.5.0** in the popup.

The updater extracts to a temporary directory and verifies all six runtime file
SHA-256 hashes before making changes. It checks the existing extension manifest,
backs up the files it replaces in a sibling directory, and replaces only
`manifest.json`, `content.js`, `popup.html`, `popup.css`, `popup.js` and
`xml-matching.js`. A copy failure triggers a rollback attempt and reports the
backup location. Unrelated files and Chrome profile/Cube storage are untouched.

For a different local folder, the optional `-TargetDirectory` parameter overrides
the default. An optional `-ArchivePath` skips the ZIP picker. The script does not
change execution policy or require administrator elevation; file permissions and
local PowerShell policy still apply. Export Cube JSON if you want a separate
collection backup.

The checksums intentionally reject other runtime revisions. Use the matching ZIP
and updater when a future version changes the runtime files. The current v0.5
runtime and six checksums are unchanged from commit
`00894af836958512327821ee1932e0c00df97aac`; that source ZIP also works with this
ready-to-run updater.

The runtime hashes and ZIP were checked in Linux. Windows/PowerShell GUI execution
still needs a local run.
