const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const { createRenderServer } = require("./server.cjs");
const monster = {
  id: "42",
  name: "Test & Monster",
  type: "Warrior / Effect",
  level: 4,
  attribute: "DARK",
  atk: "0",
  def: "0",
  effect: "Some text.",
};
let browser;
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
});
after(async () => browser?.close());
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cube-render-server-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assetRoot = path.join(root, "assets"),
    dataRoot = path.join(root, "data");
  fs.mkdirSync(assetRoot);
  fs.writeFileSync(
    path.join(assetRoot, "manifest.json"),
    JSON.stringify({ version: 1, files: {}, artworks: {} }),
  );
  const server = createRenderServer({ assetRoot, dataRoot, ...options });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  return {
    server,
    root,
    assetRoot,
    dataRoot,
    url: "http://127.0.0.1:" + server.address().port,
  };
}
const post = (url, value, headers = {}) =>
  fetch(url + "/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(value),
  });

test("HTTP renders persist across restart, repeat requests reuse images and invalid requests stay bounded", async (t) => {
  const f = await fixture(t);
  const first = await (await post(f.url, monster)).json();
  assert.equal(first.cacheHit, false);
  const second = await (await post(f.url, monster)).json();
  assert.equal(second.cacheHit, true);
  assert.equal(second.url, first.url);
  const image = await fetch(f.url + first.url);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(image.headers.get("content-security-policy"), /sandbox/);
  assert.match(await image.text(), /Test &amp; Monster/);
  const restart = createRenderServer({
    assetRoot: f.assetRoot,
    dataRoot: f.dataRoot,
  });
  await new Promise((r) => restart.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => restart.close(r)));
  assert.equal(
    (
      await (
        await post("http://127.0.0.1:" + restart.address().port, monster)
      ).json()
    ).cacheHit,
    true,
  );
  assert.equal(
    (await post(f.url, monster, { Origin: "https://another-site.example" }))
      .status,
    403,
  );
  assert.equal((await post(f.url, { name: null })).status, 400);
  assert.equal(
    (await post(f.url, { name: "A", effect: "a".repeat(140000) })).status,
    413,
  );
  assert.equal(
    (await post(f.url, monster, { "Content-Type": "text/plain" })).status,
    415,
  );
  assert.equal((await fetch(f.url + "/renders/not-a-hash.svg")).status, 404);
});

test("cache byte limit produces a clear response and writes no partial render", async (t) => {
  const f = await fixture(t, { maxCacheBytes: 1 });
  assert.equal((await post(f.url, monster)).status, 507);
  assert.deepEqual(fs.readdirSync(path.join(f.dataRoot, "render-cache")), []);
});

test("browser decodes every sample SVG and imported legacy JSON; unsafe names remain text", async (t) => {
  const f = await fixture(t),
    page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  t.after(() => page.close());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(f.url);
  await page.waitForFunction(
    () =>
      document.querySelector("#card").complete &&
      document.querySelector("#card").naturalWidth === 813,
  );
  const options = await page.locator("#sample option").count();
  for (let i = 0; i < options; i++) {
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/api/render") && r.status() === 200,
    );
    await page.locator("#sample").selectOption(String(i));
    await response;
    await page.waitForFunction(
      () =>
        !document.querySelector("#card").hidden &&
        document.querySelector("#card").complete &&
        document.querySelector("#card").naturalWidth === 813,
    );
    const svg = await (
      await page.request.get(
        f.url + (await page.locator("#card").getAttribute("src")),
      )
    ).text();
    assert.equal(
      await page.evaluate(
        (svg) =>
          new DOMParser()
            .parseFromString(svg, "image/svg+xml")
            .querySelectorAll("parsererror").length,
        svg,
      ),
      0,
    );
  }
  const imported = { ...monster, name: "<img src=x onerror=alert(1)> & Test" };
  await page.locator("#file").setInputFiles({
    name: "cube.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ schema: "dbcd-cube-v1", cards: [imported] }),
    ),
  });
  await page.waitForFunction(
    () => document.querySelector("#imported").disabled === false,
  );
  assert.equal(
    await page.locator("#imported option").textContent(),
    imported.name,
  );
  assert.equal(await page.locator("#imported img").count(), 0);
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("server"),
  );
  assert.deepEqual(errors, []);
});

test("embedded local artwork actually paints in the browser without contacting its source URL", async (t) => {
  const f = await fixture(t);
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(f.url);
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    context.fillStyle = "#e31b23";
    context.fillRect(0, 0, 1, 1);
    return canvas.toDataURL("image/png");
  });
  fs.writeFileSync(
    path.join(f.assetRoot, "art.png"),
    Buffer.from(dataUrl.split(",")[1], "base64"),
  );
  const source = "https://www.duelingbook.com/custom-pics/0/42.jpg";
  fs.writeFileSync(
    path.join(f.assetRoot, "manifest.json"),
    JSON.stringify({
      version: 1,
      files: {},
      artworks: { [source]: "art.png" },
    }),
  );
  const withArt = createRenderServer({
    assetRoot: f.assetRoot,
    dataRoot: f.dataRoot,
  });
  await new Promise((resolve) => withArt.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => withArt.close(resolve)));
  const url = "http://127.0.0.1:" + withArt.address().port;
  const rendered = await (
    await post(url, { ...monster, artwork: source })
  ).json();
  await page.goto(url);
  const foreignRequests = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(url)) foreignRequests.push(request.url());
  });
  const color = await page.evaluate(async (imageUrl) => {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 813;
    canvas.height = 1185;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return [...context.getImageData(400, 400, 1, 1).data];
  }, url + rendered.url);
  assert.deepEqual(color, [227, 27, 35, 255]);
  assert.deepEqual(foreignRequests, []);
});
