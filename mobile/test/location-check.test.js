const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.join(__dirname, "../src/locationCheck.ts");
const source = fs.readFileSync(filename, "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded._compile(compiled, filename);
const { checkLocation } = loaded.exports;

const native = {
  getForegroundPermissionsAsync: async () => ({ status: "granted" }),
  hasServicesEnabledAsync: async () => true,
  getCurrentPositionAsync: async () => ({ coords: { latitude: -17.8, longitude: 177.4 } }),
};

test("web warning clears only after a fresh location is detected", async () => {
  let allowed = false;
  const geo = {
    getCurrentPosition(success, error, options) {
      assert.equal(options.maximumAge, 0);
      if (allowed) success({ coords: { latitude: -17.8, longitude: 177.4 } });
      else error({ code: 1 });
    },
  };
  assert.equal(await checkLocation("web", geo, native), "denied");
  allowed = true;
  assert.equal(await checkLocation("web", geo, native), "ok");
  allowed = false;
  assert.equal(await checkLocation("web", geo, native), "denied");
});

test("missing, unavailable, invalid, and timed-out web locations do not report success", async () => {
  assert.equal(await checkLocation("web", null, native), "unavailable");
  assert.equal(await checkLocation("web", { getCurrentPosition: (_, error) => error({ code: 2 }) }, native), "unavailable");
  assert.equal(await checkLocation("web", { getCurrentPosition: (_, error) => error({ code: 3 }) }, native), "unavailable");
  assert.equal(await checkLocation("web", { getCurrentPosition: (success) => success({ coords: { latitude: NaN, longitude: 0 } }) }, native), "unavailable");
  assert.equal(await checkLocation("web", { getCurrentPosition: () => {} }, native, 5), "unavailable");
});

test("native permission, services, and an actual position are checked", async () => {
  assert.equal(await checkLocation("android", null, { ...native, getForegroundPermissionsAsync: async () => ({ status: "undetermined" }) }), "denied");
  assert.equal(await checkLocation("android", null, { ...native, hasServicesEnabledAsync: async () => false }), "off");
  assert.equal(await checkLocation("android", null, { ...native, getCurrentPositionAsync: async () => { throw new Error("GPS failed"); } }), "unavailable");
  assert.equal(await checkLocation("android", null, native), "ok");
});
