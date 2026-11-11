# Single-file Windows ZIP folder updater

Download `scripts/Replace-Folder-From-Zip.bat` using GitHub's **Download raw file**
button. Save the actual `.bat`, not the GitHub HTML page, somewhere **outside the
folder you will replace**, then double-click it.

1. Select a `.zip` file.
2. In the second Explorer-style picker, navigate **inside** the destination folder
   or press **Alt+D**, paste its full path, and press Enter. Leave **Use this
   folder** in the file-name box and click **Open**. No placeholder file is created.
3. Confirm the destination shown in the replacement dialog.

The BAT extracts the ZIP to a staging directory beside the destination first.
Only after extraction succeeds does it move the old destination to a uniquely
named sibling backup and move the extracted folder into its place. The destination
keeps the same path and contains only the extracted contents. Old files, including
hidden/untracked files, are kept in the backup rather than mixed with the update.
The original directory can be restored from that backup if needed. A failed swap
attempts to restore the old folder automatically. If another process has recreated
that destination, its contents are first moved to a sibling `.recovered-...`
folder, never deleted. If recovery cannot complete, the error reports the original
backup and conflict locations. Backups and recovered folders are not auto-deleted.

If the ZIP has one outer folder containing `manifest.json` (as GitHub extension
source ZIPs do), that wrapper is removed so Chrome still sees `manifest.json`
directly inside the chosen extension folder. Other ZIPs keep their normal layout.
The ZIP can even be inside the destination: it is extracted before the old folder
is moved, and the ZIP is then retained in the backup.

Drive roots, personal root folders and their ancestors, system/application-data
folders, links/junctions anywhere in the destination ancestry, and a folder containing the running BAT are
rejected. ZIP traversal paths, absolute paths, alternate data streams and symbolic
link entries are rejected before replacement. Canceling either picker or the
confirmation changes nothing. Errors stay visible in the console.

The BAT is self-contained. It uses literal Windows PowerShell `-Command` code for
Windows Forms pickers and ZIP/filesystem commands, runs in STA mode, and does not
load a companion `.ps1`, evaluate downloaded script text, encode commands or
change execution policy. Windows PowerShell and local security policy still apply.
It requires no network access or administrator elevation. Keep the BAT somewhere
you trust and select the intended ZIP and project folder.

For Chrome updates, choose the same unpacked-extension path Chrome currently uses.
Click **Reload** in `chrome://extensions` afterward and refresh DuelingBook.
Chrome profile/Cube storage is outside the extension folder and is not accessed
by this tool. Export Cube JSON separately if you want a collection backup.

## Maintenance and verification

The readable source is in `scripts/build-zip-replacer.py`. Run it with Python to
regenerate the distributable BAT. The generated command stays below cmd.exe's
command-line size limit and is ASCII with CRLF line endings.

Run `python3 tests/zip-folder-replacer-smoke.py --pwsh /path/to/pwsh` for the
PowerShell parser and filesystem checks. Tested in official PowerShell 7.6.9 on
Linux: generic ZIP replacement, GitHub wrapper removal, exact backup retention,
empty/unsafe archive rejection, a ZIP inside the destination, self-location and
drive-root guards, linked-parent rejection, Explorer picker path resolution, and
simulated rollback preserving concurrent files. The actual cmd.exe
launcher and Windows Forms dialogs require a Windows-side check.
