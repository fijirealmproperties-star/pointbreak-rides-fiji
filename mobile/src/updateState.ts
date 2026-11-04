import { useEffect, useState } from "react";
import { Platform } from "react-native";

// Shared update state: the popup and the Profile button both read from here.
let available: string | null = null;
let started = false;
const listeners = new Set<(v: string | null) => void>();

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
  try { if (localStorage.getItem("pb-updated-to") === latest) { set(null); return; } } catch {}
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
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((regs || []).map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {}
  try { if (available) localStorage.setItem("pb-updated-to", available); } catch {}
  window.location.replace("/?v=" + Date.now());
}
