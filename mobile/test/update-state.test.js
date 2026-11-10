const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function load() {
  const filename = path.join(__dirname, "../src/updateState.ts");
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = (name) => name === "react-native" ? { Platform: { OS: "web" } } : module.require(name);
  loaded._compile(compiled, filename);
  return loaded.exports;
}

function response(body, type = "text/html", ok = true) {
  return { ok, text: async () => body, headers: { get: () => type } };
}

test("update operations cannot wait indefinitely", async () => {
  const { withUpdateTimeout } = load();
  await assert.rejects(withUpdateTimeout(new Promise(() => {}), 10), /timed out/);
  assert.equal(await withUpdateTimeout(Promise.resolve("ready"), 100), "ready");
});

test("an unavailable update leaves caches and the current app untouched", async (t) => {
  const old = {};
  for (const key of ["document", "navigator", "caches", "fetch", "localStorage", "window"]) {
    old[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => old[key] ? Object.defineProperty(globalThis, key, old[key]) : delete globalThis[key]);
  }
  const setGlobal = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let cleared = false;
  let navigated = false;
  setGlobal("document", { querySelector: () => ({ getAttribute: () => "aaaa" }) });
  setGlobal("navigator", { serviceWorker: { getRegistrations: async () => { cleared = true; return []; } } });
  setGlobal("caches", { keys: async () => { cleared = true; return []; } });
  setGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  setGlobal("window", { location: { replace: () => { navigated = true; } } });
  setGlobal("fetch", async (url) => url.startsWith("/version.json")
    ? response('{"build":"bbbb"}', "application/json")
    : response("<html>New version not available</html>"));
  const { checkForUpdate, applyUpdate } = load();
  await checkForUpdate();
  await assert.rejects(applyUpdate(), /not ready/);
  assert.equal(cleared, false);
  assert.equal(navigated, false);
});

test("a verified update clears caches and restarts the app", async (t) => {
  const old = {};
  for (const key of ["document", "navigator", "caches", "fetch", "localStorage", "window"]) {
    old[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => old[key] ? Object.defineProperty(globalThis, key, old[key]) : delete globalThis[key]);
  }
  const setGlobal = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let unregistered = false;
  let deleted = false;
  let target = "";
  setGlobal("document", { querySelector: () => ({ getAttribute: () => "aaaa" }) });
  setGlobal("navigator", { serviceWorker: { getRegistrations: async () => [{ unregister: async () => { unregistered = true; } }] } });
  setGlobal("caches", { keys: async () => ["old"], delete: async () => { deleted = true; } });
  setGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  setGlobal("window", { location: { replace: (url) => { target = url; } } });
  setGlobal("fetch", async (url) => {
    if (url.startsWith("/version.json")) return response('{"build":"bbbb"}', "application/json");
    if (url.startsWith("/_expo/")) return response("console.log('new app')", "application/javascript");
    return response('<meta name="pb-build" content="bbbb"><script src="/_expo/static/js/app.js"></script>');
  });
  const { checkForUpdate, applyUpdate } = load();
  await checkForUpdate();
  await applyUpdate();
  assert.equal(unregistered, true);
  assert.equal(deleted, true);
  assert.match(target, /^\/\?v=/);
});
