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
2. Download **both** `scripts/run-update.cmd` and `scripts/update-from-zip.ps1`
   through GitHub's **Download raw file** button. Keep them in the same local
   folder with these exact names. Replace older copies rather than using names
   such as `update-from-zip (1).ps1`. Save files themselves, not the HTML pages.
3. **Double-click `run-update.cmd`.** It starts Windows PowerShell with `-NoProfile`
   and `-STA` (the thread mode required by the ZIP picker). The console stays open
   at the end, including startup, parsing or policy errors that cannot be caught
   inside a `.ps1` file. It does not override execution policy.
4. Select the ZIP in the picker, which is shown in front of other windows. A
   completion dialog shows the target folder and backup location. Canceling makes
   no changes. If no picker appears, copy the error from the console window for
   diagnosis.
5. Click **Reload** in `chrome://extensions`, then refresh DuelingBook. Confirm
   **Prototype v0.5.0** in the popup.

Directly choosing **Run with PowerShell** on the `.ps1` is still possible, but a
failure before the script body starts can close that host without showing the
script's error dialog. The launcher keeps those failures visible and avoids
custom profiles or a different thread mode.

The updater extracts to a temporary directory and verifies all six runtime file
SHA-256 hashes before making changes. It checks the existing extension manifest,
backs up the files it replaces in a sibling directory, and replaces only
`manifest.json`, `content.js`, `popup.html`, `popup.css`, `popup.js` and
`xml-matching.js`. A copy failure triggers a rollback attempt and reports the
backup location. Unrelated files and Chrome profile/Cube storage are untouched.

For a different local folder, the optional `-TargetDirectory` parameter overrides
the default. An optional `-ArchivePath` skips the ZIP picker. `-NoDialogs` with an explicit
`-ArchivePath` enables command-line validation without Windows Forms. The script does not
change execution policy or require administrator elevation; file permissions and
local PowerShell policy still apply. Export Cube JSON if you want a separate
collection backup.

The checksums intentionally reject other runtime revisions. Use the matching ZIP
and updater when a future version changes the runtime files. The current v0.5
runtime and six checksums are unchanged from commit
`00894af836958512327821ee1932e0c00df97aac`; that source ZIP also works with this
ready-to-run updater.

The runtime hashes and ZIP are checked in Linux. PowerShell syntax and non-GUI
filesystem behavior are also checked with official portable PowerShell. The actual
Windows launcher, picker focus and local execution-policy behavior still need a
local run.
