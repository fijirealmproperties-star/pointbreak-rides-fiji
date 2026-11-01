import { Platform } from "react-native";
import { api } from "./api";

// Web Push + in-app alert sound (web/PWA only; native builds ignore these).
const isWeb = Platform.OS === "web" && typeof window !== "undefined";

export function pushSupported(): boolean {
  return isWeb && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Asks for permission (must be called from a tap) and registers this device
// with the server so ride alerts arrive even when the app is closed.
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!isWeb) return { ok: false };
  if (!pushSupported()) {
    return { ok: false, reason: "Install the app to your home screen (Share → Add to Home Screen) to get alerts when it is closed." };
  }
  try {
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: "Notifications are blocked. Allow them in your phone settings for Pointbreak." };
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api<{ key: string }>("/push/key");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    await api("/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "Could not enable notifications." };
  }
}

export async function sendTestPush(): Promise<number> {
  const r = await api<{ sent: number }>("/push/test", { method: "POST", body: {} });
  return r.sent;
}

let audioCtx: any = null;
let alertTimer: ReturnType<typeof setInterval> | null = null;

function beep() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    [0, 0.22].forEach((offset, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = i === 0 ? 880 : 1175;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + offset);
      g.gain.exponentialRampToValueAtTime(0.5, audioCtx.currentTime + offset + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + offset + 0.2);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime + offset);
      o.stop(audioCtx.currentTime + offset + 0.22);
    });
    if (navigator.vibrate) navigator.vibrate([300, 120, 300]);
  } catch {}
}

// Repeating chime while a ride offer is on screen.
export function startRideAlert() {
  if (!isWeb || alertTimer) return;
  beep();
  alertTimer = setInterval(beep, 1500);
}

export function stopRideAlert() {
  if (alertTimer) clearInterval(alertTimer);
  alertTimer = null;
}

// Browsers only allow audio after a user gesture; call from the Go Online tap.
export function primeAudio() {
  if (!isWeb) return;
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {}
}
