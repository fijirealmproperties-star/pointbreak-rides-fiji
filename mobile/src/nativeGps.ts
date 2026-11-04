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
  const cap = (globalThis as any).Capacitor;
  return !!(cap && cap.isNativePlatform && cap.isNativePlatform() && cap.registerPlugin);
}

let plugin: any = null;
function getPlugin() {
  if (!plugin) plugin = (globalThis as any).Capacitor.registerPlugin("BackgroundGeolocation");
  return plugin;
}

// Returns a stop function. Throws if the native side can't start.
export async function startNativeWatch(
  onFix: (f: NativeFix) => void,
  onError: (code: string) => void
): Promise<() => void> {
  const p = getPlugin();
  const id: string = await p.addWatcher(
    {
      backgroundTitle: "Pointbreak is using your location",
      backgroundMessage: "Keeping your position accurate",
      requestPermissions: true,
      stale: false,
      distanceFilter: 0,
    },
    (loc: any, err: any) => {
      if (err) { onError(err.code || "ERROR"); return; }
      if (loc) onFix(loc as NativeFix);
    }
  );
  return () => { try { p.removeWatcher({ id }); } catch {} };
}
