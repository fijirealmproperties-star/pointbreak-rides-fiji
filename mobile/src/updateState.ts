import { useEffect, useState } from "react";
import { Platform } from "react-native";

// Shared update state: the popup and the Profile button both read from here.
let available: string | null = null;
let started = false;
const listeners = new Set<(v: string | null) => void>();
const UPDATE_TIMEOUT_MS = 10000;

export async function withUpdateTimeout<T>(operation: Promise<T>, timeoutMs = UPDATE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Update timed out. Check your connection and try again.")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

function set(v: string | null) {
  if (v === available) return;
  available = v;
  listeners.forEach((l) => l(v));
}

export function currentBuild(): string | null {
  if (typeof document === "undefined") return null;
  const v = document.querySelector('meta[name="pb-build"]')?.getAttribute("content");
  return v && v !== "__PB_BUILD__" ? v : null;
}

export async function checkForUpdate() {
  const mine = currentBuild();
  if (!mine) return;
  let latest: string | null = null;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    const m = (await res.text()).match(/"build"\s*:\s*"([a-f0-9]+)"/);
    if (m) latest = m[1];
  } catch {}
  if (!latest) {
    try {
      const res = await fetch(`/?t=${Date.now()}`, { cache: "no-store" });
      const m = (await res.text()).match(/name="pb-build"\s+content="([a-f0-9]+)"/);
      if (m) latest = m[1];
    } catch {}
  }
  if (!latest) return;
  if (latest === mine) { set(null); return; }
  // Only stop asking after several reloads failed to reach the new build, so a stale copy never hides the update.
  try {
    const tries = Number(localStorage.getItem("pb-update-tries") || 0);
    if (localStorage.getItem("pb-updated-to") === latest && tries >= 3) { set(null); return; }
  } catch {}
  set(latest);
}

function start() {
  if (started || Platform.OS !== "web") return;
  started = true;
  checkForUpdate();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForUpdate(); });
  window.addEventListener("focus", checkForUpdate);
  setInterval(checkForUpdate, 20000);
}

export function useUpdateAvailable(): string | null {
  const [v, setV] = useState<string | null>(available);
  useEffect(() => {
    start();
    listeners.add(setV);
    setV(available);
    return () => { listeners.delete(setV); };
  }, []);
  return v;
}

// Clears cached copies and loads the newest build; the app restarts on the new version.
export async function applyUpdate() {
  const expected = available;
  if (!expected) throw new Error("No update is currently available. Please try again later.");

  const fetchUpdate = async (url: string) => {
    const controller = new AbortController();
    try {
      return await withUpdateTimeout((async () => {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const body = await response.text();
        return { response, body };
      })());
    } finally {
      controller.abort();
    }
  };
  let html: string;
  try {
    const { response, body } = await fetchUpdate(`/?t=${Date.now()}`);
    if (!response.ok) throw new Error("Update page unavailable");
    html = body;
  } catch {
    throw new Error("Could not download the update. Check your connection and try again.");
  }
  const build = html.match(/<meta name="pb-build" content="([a-f0-9]+)"/);
  const js = html.match(/src="(\/_expo\/static\/js\/[^"]+)"/);
  if (!build || build[1] !== expected || !js) {
    throw new Error("The new version is not ready yet. Please try again later.");
  }
  try {
    const { response, body } = await fetchUpdate(js[1]);
    if (!response.ok) throw new Error("Update bundle unavailable");
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html") || !body.trim()) throw new Error("Update bundle is not JavaScript");
  } catch {
    throw new Error("Could not download the update. Check your connection and try again.");
  }
  try {
    const regs = await withUpdateTimeout(navigator.serviceWorker?.getRegistrations() || Promise.resolve([]));
    await withUpdateTimeout(Promise.all(regs.map((r) => r.unregister())));
    if (typeof caches !== "undefined") {
      const keys = await withUpdateTimeout(caches.keys());
      await withUpdateTimeout(Promise.all(keys.map((k) => caches.delete(k))));
    }
  } catch {
    throw new Error("Could not prepare the update. Close and reopen the app, then try again.");
  }
  let tries = 0;
  try {
    const same = localStorage.getItem("pb-updated-to") === available;
    tries = same ? Number(localStorage.getItem("pb-update-tries") || 0) + 1 : 1;
    if (available) localStorage.setItem("pb-updated-to", available);
    localStorage.setItem("pb-update-tries", String(tries));
  } catch {}
  const path = tries % 2 === 0 ? "/index.html" : "/";
  window.location.replace(`${path}?v=${Date.now()}`);
}
