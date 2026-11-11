const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function load(file, mocks = {}) {
  const filename = path.join(__dirname, "../src", file);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = (name) => Object.prototype.hasOwnProperty.call(mocks, name)
    ? mocks[name]
    : module.require(name);
  loaded._compile(compiled, filename);
  return loaded.exports;
}

test("waiting timer displays recorded minutes and seconds without rounding ahead", () => {
  const { fmtWaitTimer } = load("theme.ts");
  assert.equal(fmtWaitTimer(0), "00:00");
  assert.equal(fmtWaitTimer(30 / 60), "00:30");
  assert.equal(fmtWaitTimer(125 / 60), "02:05");
  assert.equal(fmtWaitTimer(3600 / 60), "60:00");
  assert.equal(fmtWaitTimer(null), "—");
  assert.equal(fmtWaitTimer(NaN), "—");
  assert.equal(fmtWaitTimer(-1), "—");
});

test("requested ride meter displays its recorded waiting time", () => {
  const theme = load("theme.ts");
  const { default: TaxiMeter } = load("components/TaxiMeter.tsx", {
    "../theme": theme,
    "../rideMeterDisplay": load("rideMeterDisplay.ts"),
    "react": { ...require("react"), useState: () => [0, () => {}], useEffect: () => {} },
    "react-native": {
      View: "View",
      Text: "Text",
      StyleSheet: { create: (styles) => styles },
    },
  });
  const element = TaxiMeter({ ride: {
    fare: 2.09, distance_km: 2.73, duration_min: 4,
    meter_distance_km: 0, meter_fare: 2.09, meter_wait_min: 0.5,
  } });
  const text = [];
  function collect(node) {
    if (typeof node === "string" || typeof node === "number") text.push(String(node));
    else if (Array.isArray(node)) node.forEach(collect);
    else if (node && node.props) collect(node.props.children);
  }
  collect(element);
  assert.ok(text.includes("WAITING TIME"));
  assert.ok(text.includes("00:30"));
});

test("requested ride meter labels the estimated timer and fare", () => {
  const { default: TaxiMeter } = load("components/TaxiMeter.tsx", {
    "../theme": load("theme.ts"),
    "../rideMeterDisplay": load("rideMeterDisplay.ts"),
    "react": { ...require("react"), useState: () => [4000, () => {}], useEffect: () => {} },
    "react-native": { View: "View", Text: "Text", StyleSheet: { create: (styles) => styles } },
  });
  const element = TaxiMeter({ ride: {
    fare: 2, distance_km: 1, duration_min: 4, meter_distance_km: 0,
    meter_fare: 2.18, meter_wait_min: 1, speed_kmh: 0, stopped_recv_at: 1000,
  } });
  const text = [];
  function collect(node) {
    if (typeof node === "string" || typeof node === "number") text.push(String(node));
    else if (Array.isArray(node)) node.forEach(collect);
    else if (node && node.props) collect(node.props.children);
  }
  collect(element);
  assert.ok(text.includes("01:03"));
  assert.ok(text.includes("FJ$2.19"));
  assert.ok(text.includes("Estimated between updates · final fare confirmed by server"));
});

test("stationary GPS fixes reach the ride meter without moving the map position", () => {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let success;
  let stopped = false;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { geolocation: {
      watchPosition(onSuccess) { success = onSuccess; return 42; },
      clearWatch(id) { assert.equal(id, 42); stopped = true; },
    } },
  });

  try {
    const { watchCurrentLocation } = load("geo.ts", {
      "./nativeGps": { nativeGpsAvailable: () => false },
      "expo-location": {},
    });
    const positions = [];
    const stop = watchCurrentLocation((p) => positions.push(p), undefined, 250, true);
    success({ coords: { latitude: -17.8, longitude: 177.4, accuracy: 10, speed: 0 } });
    success({ coords: { latitude: -17.80001, longitude: 177.4, accuracy: 10, speed: 0 } });
    assert.equal(positions.length, 2);
    assert.equal(positions[1].lat, positions[0].lat);
    assert.equal(positions[1].speed, 0);
    stop();
    assert.equal(stopped, true);
  } finally {
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator);
    else delete globalThis.navigator;
  }
});

test("stationary visual updates are limited without suppressing movement or the five-second meter update", () => {
  const { skipFrequentStationaryUpdate } = load("geo.ts", {
    "./nativeGps": { nativeGpsAvailable: () => false },
    "expo-location": {},
  });
  const last = { lat: -17.8, lng: 177.4, at: 1000 };
  const still = { lat: -17.8, lng: 177.4, accuracy: 10, speed: 0 };
  assert.equal(skipFrequentStationaryUpdate(still, null, 2000), false);
  assert.equal(skipFrequentStationaryUpdate(still, last, 2000), true);
  assert.equal(skipFrequentStationaryUpdate(still, last, 6000), false);
  assert.equal(skipFrequentStationaryUpdate({ ...still, speed: 5 }, last, 2000), false);
  assert.equal(skipFrequentStationaryUpdate({ ...still, lat: -17.799 }, last, 2000), false);
  assert.equal(skipFrequentStationaryUpdate({ ...still, speed: null }, last, 2000), false);
});
