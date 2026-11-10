const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function load(name, dependencies) {
  const filename = path.join(__dirname, "../src", name + ".ts");
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = (id) => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    return module.require(id);
  };
  loaded._compile(compiled, filename);
  return loaded.exports;
}

function setup(t, options = {}) {
  const callbacks = {};
  const removed = [];
  const calls = [];
  const plugin = {
    checkPermissions: async () => ({ receive: options.permission || "granted" }),
    requestPermissions: async () => ({ receive: options.permission || "granted" }),
    addListener: async (name, cb) => {
      callbacks[name] = cb;
      return { remove: async () => { removed.push(name); } };
    },
    register: async () => {
      if (options.error) callbacks.registrationError({ error: "Firebase unavailable" });
      else callbacks.registration({ value: "test-fcm-token" });
    },
  };
  const original = globalThis.Capacitor;
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    isPluginAvailable: () => options.available !== false,
    registerPlugin: () => plugin,
  };
  t.after(() => { globalThis.Capacitor = original; });
  const native = load("nativePush", { "./api": { api: async (url, opts) => {
    calls.push({ url, opts });
    if (options.serverError) throw new Error("Server unavailable");
  } } });
  return { native, calls, removed };
}

test("native registration succeeds only after the FCM token is saved", async (t) => {
  const { native, calls, removed } = setup(t);
  assert.deepEqual(await native.registerNativePush(), { ok: true, token: "test-fcm-token" });
  assert.equal(calls[0].url, "/push/fcm");
  assert.equal(calls[0].opts.body.token, "test-fcm-token");
  assert.deepEqual(removed.sort(), ["registration", "registrationError"]);
});

test("native registration reports Firebase and server errors", async (t) => {
  const failure = setup(t, { error: true });
  assert.match((await failure.native.registerNativePush()).reason, /Firebase unavailable/);
  assert.equal(failure.calls.length, 0);
  const server = setup(t, { serverError: true });
  assert.match((await server.native.registerNativePush()).reason, /Server unavailable/);
});

test("missing plugin and denied permission do not report success", async (t) => {
  const missing = setup(t, { available: false });
  assert.equal((await missing.native.registerNativePush()).ok, false);
  const denied = setup(t, { permission: "denied" });
  assert.equal((await denied.native.registerNativePush()).ok, false);
  assert.equal(denied.calls.length, 0);
});

test("enabling push in the Android app never subscribes to web push", async () => {
  let calls = 0;
  const native = {
    isNativeApp: () => true,
    registerNativePush: async () => { calls++; return { ok: false, reason: "native unavailable" }; },
  };
  const push = load("push", { "react-native": { Platform: { OS: "web" } }, "./api": {}, "./nativePush": native });
  assert.deepEqual(await push.enablePush(), { ok: false, reason: "native unavailable" });
  assert.equal(calls, 1);
});

test("regular browsers continue to register web push", async (t) => {
  const oldWindow = globalThis.window;
  const oldNavigator = globalThis.navigator;
  const oldNotification = globalThis.Notification;
  t.after(() => {
    globalThis.window = oldWindow;
    Object.defineProperty(globalThis, "navigator", { value: oldNavigator, configurable: true, writable: true });
    globalThis.Notification = oldNotification;
  });
  const sub = { toJSON: () => ({ endpoint: "browser-endpoint" }) };
  const registration = { pushManager: { getSubscription: async () => sub } };
  globalThis.window = { PushManager: {}, Notification: {} };
  Object.defineProperty(globalThis, "navigator", { value: { serviceWorker: { ready: Promise.resolve(registration) } }, configurable: true, writable: true });
  globalThis.Notification = { permission: "granted" };
  const calls = [];
  const push = load("push", {
    "react-native": { Platform: { OS: "web" } },
    "./nativePush": { isNativeApp: () => false },
    "./api": { api: async (url, opts) => {
      calls.push({ url, opts });
      if (url === "/push/key") return { key: "AQ" };
    } },
  });
  assert.deepEqual(await push.enablePush(), { ok: true });
  assert.equal(calls[1].url, "/push/subscribe");
  assert.equal(calls[1].opts.body.subscription.endpoint, "browser-endpoint");
});

test("blocked browser permission gives site settings guidance without prompting again", async (t) => {
  const oldWindow = globalThis.window;
  const oldNavigator = globalThis.navigator;
  const oldNotification = globalThis.Notification;
  t.after(() => {
    globalThis.window = oldWindow;
    Object.defineProperty(globalThis, "navigator", { value: oldNavigator, configurable: true, writable: true });
    globalThis.Notification = oldNotification;
  });
  let prompted = false;
  globalThis.window = { PushManager: {}, Notification: {} };
  Object.defineProperty(globalThis, "navigator", { value: { serviceWorker: {} }, configurable: true, writable: true });
  globalThis.Notification = { permission: "denied", requestPermission: () => { prompted = true; throw new Error("should not prompt"); } };
  const push = load("push", {
    "react-native": { Platform: { OS: "web" } },
    "./nativePush": { isNativeApp: () => false },
    "./api": { api: () => { throw new Error("should not subscribe"); } },
  });
  const result = await push.enablePush();
  assert.equal(result.ok, false);
  assert.match(result.reason, /browser's site settings/);
  assert.equal(prompted, false);
});
