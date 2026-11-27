const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("the drafter artifact runs on its own and serves only drafter routes", async (t) => {
  const build = path.resolve(__dirname, "../../dist/drafter");
  assert.deepEqual(fs.readdirSync(build).sort(), ["drafter", "shared", "start.cjs"]);
  const files = fs.readdirSync(build, { recursive: true }).map(file => file.replaceAll("\\", "/"));
  assert.ok(files.includes("drafter/renderer/packs/manifest.json"));
  assert.ok(files.every(file => !/(?:^|\/)(?:content\.js|popup\.(?:html|js|css)|extension|node_modules|data)$|\.test\.cjs$/.test(file)));
  const temp = fs.realpathSync(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(temp, "drafter-production-"));
  let server;
  t.after(async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    const resolved = fs.realpathSync(scratch);
    assert.equal(path.dirname(resolved), temp);
    fs.rmSync(resolved, { recursive: true });
  });
  const runtime = path.join(scratch, "runtime");
  fs.cpSync(build, runtime, { recursive: true });
  const { createRenderServer } = require(path.join(runtime, "drafter/backend/server.cjs"));
  const { CUBE_SCHEMA } = require(path.join(runtime, "shared/cube-format.cjs"));
  server = createRenderServer({ dataRoot: path.join(scratch, "data"), publicOnly: true });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  const fetchRoute = (route, options) => fetch(url + route, options);
  assert.equal((await fetchRoute("/", { redirect: "manual" })).headers.get("location"), "/draft");
  for (const route of ["/draft", "/mock-cube.js", "/room-client.js", "/draft-renderer.js", "/cube-library.js", "/card-icons/attribute.DARK"]) {
    const result = await fetchRoute(route);
    assert.equal(result.status, 200, route);
    await result.arrayBuffer();
  }
  for (const route of ["/tester", "/api/style", "/extension/manifest.json", "/popup.js", "/content.js"]) {
    assert.equal((await fetchRoute(route)).status, 404, route);
  }
  const imported = await fetchRoute("/api/cubes/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Cube-Owner": "a".repeat(64) },
    body: JSON.stringify({ name: "Production test", cube: {
      schema: CUBE_SCHEMA, cards: [{ id: "42", name: "Test card", copies: 1 }],
    } }),
  });
  assert.equal(imported.status, 201);
  assert.equal((await imported.json()).cube.cards[0].name, "Test card");
  assert.ok(fs.existsSync(path.join(scratch, "data", "cubes.sqlite")));
});
