import { api } from "./api";
import { isNativeApp, nativePlugin, PluginListener } from "./nativeBridge";

type PushResult = { ok: boolean; reason?: string; token?: string };
export { isNativeApp };

let registration: Promise<PushResult> | null = null;

export function registerNativePush(requestPermission = true): Promise<PushResult> {
  if (registration) return registration;
  registration = register(requestPermission).finally(() => { registration = null; });
  return registration;
}

async function register(requestPermission: boolean): Promise<PushResult> {
  const listeners: PluginListener[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const p = nativePlugin("PushNotifications");
    if (!p) return { ok: false, reason: "App notifications are unavailable. Install the latest Pointbreak Android app." };
    let permission = await p.checkPermissions();
    if (permission.receive !== "granted" && requestPermission) permission = await p.requestPermissions();
    if (permission.receive !== "granted") {
      return { ok: false, reason: "Allow notifications in Settings > Apps > Pointbreak > Notifications." };
    }

    let resolveToken!: (token: string) => void;
    let rejectToken!: (error: Error) => void;
    const tokenPromise = new Promise<string>((resolve, reject) => {
      resolveToken = resolve;
      rejectToken = reject;
    });
    void tokenPromise.catch(() => {});
    listeners.push(await p.addListener("registration", ({ value }) => {
      if (value) resolveToken(value);
      else rejectToken(new Error("Firebase returned an empty registration token."));
    }));
    listeners.push(await p.addListener("registrationError", ({ error }) => {
      rejectToken(new Error(error || "Firebase registration failed."));
    }));
    timer = setTimeout(() => rejectToken(new Error("Firebase registration timed out.")), 15000);
    await p.register();
    const token = await tokenPromise;
    await api("/push/fcm", { method: "POST", body: { token } });
    return { ok: true, token };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn("Native push registration failed:", detail);
    return { ok: false, reason: `Could not connect app notifications: ${detail}` };
  } finally {
    if (timer) clearTimeout(timer);
    await Promise.all(listeners.map(listener => listener.remove().catch(error => {
      console.warn("Could not remove push listener:", error);
    })));
  }
}
