# DuelingBook Cube Draft

An unofficial Chrome extension for collecting DuelingBook cards and a separate
web application for hosting Cube drafts. The apps exchange `dbcd-cube-v1` JSON.

| Directory | Purpose | Build from repository root |
| --- | --- | --- |
| [extension/](extension/README.md) | Chrome extension, Windows ZIP updater, and extension tests | `npm run build:extension` → `dist/extension/` |
| [drafter/](drafter/README.md) | Browser frontend, Node.js backend, renderer, and drafter tests | `npm run build:drafter` → `dist/drafter/` |
| [shared/](shared/README.md) | Cube and card interchange format and shared validators | Included by each build |
| `integration/` | Tests that render cards exported by the extension | `npm run test:integration` |

Use Node.js 24. Both builds run without installing npm dependencies.
For drafter development, run `npm run start:drafter` and open
[the local draft page](http://127.0.0.1:3210/draft). For the extension, build it
and load `dist/extension/` as an unpacked extension. If you used the repository
root as an unpacked extension, export your Cube before updating that checkout
so you can restore it after changing the loaded folder.

To run the checks locally:

~~~sh
npm ci
npx playwright install chromium
npm run test:extension
npm run test:drafter
npm run test:integration
~~~

Use `npm test` to run all three suites. On Linux, add `--with-deps` to the
Playwright install if the browser libraries are missing. Set `CHROMIUM_PATH`
to use an existing Chrome or Edge installation instead.

GitHub Actions builds the apps separately. The extension workflow publishes
a Chrome Web Store ZIP as a build artifact and the drafter workflow publishes
a standalone Node.js runtime archive. See [drafter deployment](drafter/DEPLOYMENT.md)
for Windows and Render instructions using the GitHub `main` branch.
