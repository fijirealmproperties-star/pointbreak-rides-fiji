import { nativePlugin } from "./nativeBridge";

// Native (Android) GPS through a foreground service. It reads the phone's GNSS chip
// directly, needs no mobile data, and keeps running with the screen off.
export type NativeFix = {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  time: number | null;
};

export function nativeGpsAvailable(): boolean {
  return !!nativePlugin("BackgroundGeolocation");
}

function getPlugin() {
  const plugin = nativePlugin("BackgroundGeolocation");
  if (!plugin) throw new Error("Background GPS plugin is unavailable.");
  return plugin;
}

// One shared native watcher feeds every listener (home map, roadside meter, Surfs Up meter),
// so starting or stopping one never interrupts the live feed of another.
type Sub = { onFix: (f: NativeFix) => void; onError: (code: string) => void };
const subs = new Set<Sub>();
let watcherId: string | null = null;
let starting: Promise<void> | null = null;

async function ensureWatcher(): Promise<void> {
  if (watcherId) return;
  if (starting) return starting;
  const p = getPlugin();
  starting = p
    .addWatcher(
      {
        backgroundTitle: "Pointbreak is using your location",
        backgroundMessage: "Keeping your position accurate",
        requestPermissions: true,
        stale: false,
        distanceFilter: 0,
      },
      (loc, err) => {
        if (err) { const c = err.code || "ERROR"; subs.forEach((s) => s.onError(c)); return; }
        if (loc) subs.forEach((s) => s.onFix(loc as NativeFix));
      }
    )
    .then((id: string) => {
      watcherId = id;
      if (subs.size === 0) releaseWatcher();
    })
    .finally(() => { starting = null; });
  return starting as Promise<void>;
}

function releaseWatcher() {
  if (!watcherId) return;
  const id = watcherId;
  watcherId = null;
  getPlugin().removeWatcher({ id }).catch(error => console.warn("Could not stop background GPS:", error));
}

// Returns a stop function. Throws if the native side can't start.
export async function startNativeWatch(
  onFix: (f: NativeFix) => void,
  onError: (code: string) => void
): Promise<() => void> {
  const sub: Sub = { onFix, onError };
  subs.add(sub);
  try {
    await ensureWatcher();
  } catch (e) {
    subs.delete(sub);
    throw e;
  }
  return () => {
    subs.delete(sub);
    if (subs.size === 0) releaseWatcher();
  };
}