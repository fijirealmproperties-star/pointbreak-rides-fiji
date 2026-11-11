const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.join(__dirname, "../src/rideMeterDisplay.ts");
const source = fs.readFileSync(filename, "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded._compile(compiled, filename);
const { estimateRideMeter } = loaded.exports;

test("estimates waiting time and fare between recent confirmed readings", () => {
  const result = estimateRideMeter(1, 2.18, 0, 1000, 4000);
  assert.equal(result.estimated, true);
  assert.equal(result.waitMin, 1.05);
  assert.ok(Math.abs(result.fare - 2.189) < 1e-10);
  assert.equal(estimateRideMeter(1, 2.18, 0, 1000, 1000).estimated, false);
  assert.equal(estimateRideMeter(1, 2.18, 9.9, 1000, 6000).estimated, true);
});

test("does not estimate when moving, disconnected, or missing a valid reading", () => {
  const confirmed = { waitMin: 1, fare: 2.18, estimated: false };
  assert.deepEqual(estimateRideMeter(1, 2.18, 10, 1000, 3000), confirmed);
  assert.deepEqual(estimateRideMeter(1, 2.18, 0, 1000, 6001), confirmed);
  assert.deepEqual(estimateRideMeter(1, 2.18, 0, 1000, 999), confirmed);
  assert.deepEqual(estimateRideMeter(1, 2.18, null, 1000, 3000), confirmed);
  assert.deepEqual(estimateRideMeter(1, 2.18, 0, null, 3000), confirmed);
  assert.deepEqual(estimateRideMeter(null, 2.18, 0, 1000, 3000), { waitMin: null, fare: 2.18, estimated: false });
  assert.deepEqual(estimateRideMeter(1, null, 0, 1000, 3000), { waitMin: 1, fare: null, estimated: false });
});
