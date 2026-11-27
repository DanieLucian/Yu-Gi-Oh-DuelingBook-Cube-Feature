# Deploy the drafter from GitHub main

Once the monorepo change is merged, both setups below use only the drafter
runtime and the shared Cube-format module. The Chrome extension has a separate
build and release process.

## Windows PC

Install Git and Node.js 24. In PowerShell, clone `main` into a dedicated hosting
folder. Sparse checkout keeps the extension out of this working tree.

~~~powershell
git clone --filter=blob:none --sparse --single-branch --branch main https://github.com/DanieLucian/Yu-Gi-Oh-DuelingBook-Cube-Feature.git cube-draft-host
Set-Location cube-draft-host
git sparse-checkout set drafter shared tools
node drafter/build.cjs
$env:DATA_ROOT = Join-Path $env:LOCALAPPDATA 'DuelingBookCubeDraft\drafter'
node dist/drafter/start.cjs
~~~

Open [the local draft page](http://127.0.0.1:3210/draft). The terminal must stay
open. The gallery is at `/` and the typography tester is at `/tester`.
`HOST` defaults to `127.0.0.1` and `PORT` defaults to `3210`. For a
LAN session, set `$env:HOST = '0.0.0.0'`, allow the chosen port through
Windows Firewall, and append `--public` to the start command to disable
the renderer administration routes. Friends use the PC's LAN address plus
`:3210/draft`. See the [temporary internet hosting instructions](README.md)
if you already use the Windows tunnel script.

Keep `DATA_ROOT` outside `dist/`. It holds saved rooms, session archives,
`cubes.sqlite`, fonts, styles, and caches. If you already have those files in
`platform-design\renderer\data` in a previous checkout, stop the old server
and copy that directory to the new data location or point `DATA_ROOT` to
its absolute path. Only one server should use the directory at a time.
Back it up while the server is stopped. Browser seat and Cube credentials
also depend on the origin, so reuse the same address and port to resume.
If you have a custom renderer asset manifest, point `ASSET_ROOT` at its
directory. The build ships the bundled templates and reads your private
asset overrides from that separate location at runtime.

To update, stop the server with Ctrl+C, run `git pull --ff-only origin main`,
run `node drafter/build.cjs`, and restart with the same `DATA_ROOT`. You can
also extract `duelingbook-drafter.tar.gz` from the **drafter-runtime** artifact
of a successful [Drafting platform workflow](../.github/workflows/drafter.yml)
on `main`. Then run `node start.cjs` from the extracted directory with
the same data path.

## Render

1. In the Render dashboard choose **New → Blueprint**, connect this GitHub
   repository, select `main`, and use the root `render.yaml`. Review and
   deploy the single Docker web service. [Render Blueprint setup](https://render.com/docs/infrastructure-as-code)
2. Use the paid Starter plan and persistent disk in the Blueprint. The disk
   mounts at `/var/data`, which is also the container's `DATA_ROOT`. Keep
   one service instance because room state is file backed and the catalog
   uses SQLite. Render briefly interrupts service during a disk-backed
   redeploy. [Render persistent disks](https://render.com/docs/disks)
3. Open `https://<service-name>.onrender.com/draft`. The container binds to
   `0.0.0.0:10000`, uses `/draft` for its health check, and starts in
   public mode so the gallery and typography administration are private.
   Keep the same HTTPS origin if players need to resume rooms.
4. Future deploys follow changes on `main` to the drafter, shared format,
   or its build configuration once CI passes. The Docker context and final
   image exclude the Chrome extension. [Render monorepo builds](https://render.com/docs/monorepo-support)

To build and run the same public-mode container locally, use Docker from the
repository root:

~~~sh
docker build -f drafter/Dockerfile -t cube-drafter .
docker run --rm -p 127.0.0.1:10000:10000 -v cube-draft-data:/var/data cube-drafter
~~~
