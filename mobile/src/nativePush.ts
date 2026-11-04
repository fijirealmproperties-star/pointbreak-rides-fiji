import { api } from "./api";

// Android APK: register this phone with Firebase so alerts arrive even when the app is closed.
function plugin(): any | null {
  const cap = (globalThis as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  try {
    return cap.isPluginAvailable("PushNotifications") ? cap.registerPlugin("PushNotifications") : null;
  } catch {
    return null;
  }
}

export function nativePushAvailable(): boolean {
  return !!plugin();
}

let listening = false;

export async function registerNativePush(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try {
    let perm = await p.checkPermissions();
    if (perm.receive !== "granted") perm = await p.requestPermissions();
    if (perm.receive !== "granted") return false;
    if (!listening) {
      listening = true;
      await p.addListener("registration", (t: { value: string }) => {
        api("/push/fcm", { method: "POST", body: { token: t.value } }).catch(() => {});
      });
      await p.addListener("registrationError", () => {});
    }
    await p.register();
    return true;
  } catch {
    return false;
  }
}