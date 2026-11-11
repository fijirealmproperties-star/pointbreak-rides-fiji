import * as Location from "expo-location";
import { nativeGpsAvailable, startNativeWatch } from "./nativeGps";

export type MeterFix = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  time: number | null;
};

// Restart the GPS source if it goes quiet this long while a trip is running.
const SILENCE_MS = 10000;

// Hardened location feed for the meters. It picks the best source (Android background
// service, browser GPS, or expo-location), restarts it if it stalls, and re-attaches
// when the screen comes back, so a trip never silently loses its live feed.
export function startMeterGps(
  onFix: (f: MeterFix) => void,
  onProblem: (kind: "denied" | "unavailable") => void
): () => void {
  let active = true;
  let stopSource: (() => void) | null = null;
  let lastRaw = Date.now();
  let starting = false;
  let usingNative = false;
  let gotFix = false;
  let forceWeb = false;

  const deliver = (f: MeterFix) => {
    if (!active) return;
    gotFix = true;
    lastRaw = Date.now();
    onFix(f);
  };

  async function attach() {
    if (!active || starting) return;
    starting = true;
    try {
      stopSource?.();
      stopSource = null;
      let stop: () => void;
      usingNative = nativeGpsAvailable() && !forceWeb;
      if (usingNative) {
        stop = await startNativeWatch(
          (f) => deliver({ latitude: f.latitude, longitude: f.longitude, accuracy: f.accuracy, speed: f.speed, time: f.time }),
          (code) => { if (code === "NOT_AUTHORIZED") onProblem("denied"); }
        );
      } else if (typeof navigator !== "undefined" && navigator.geolocation) {
        const id = navigator.geolocation.watchPosition(
          (p) => deliver({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
            speed: Number.isFinite(p.coords.speed as number) ? p.coords.speed : null,
            time: p.timestamp,
          }),
          (e) => { if (e.code === 1) onProblem("denied"); },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
        );
        stop = () => navigator.geolocation.clearWatch(id);
      } else {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") { onProblem("denied"); return; }
        const s = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
          (loc) => deliver({ ...loc.coords, time: loc.timestamp })
        );
        stop = () => s.remove();
      }
      if (active) stopSource = stop;
      else stop();
      lastRaw = Date.now();
    } catch {
      if (usingNative && !gotFix) forceWeb = true;
      onProblem("unavailable");
    } finally {
      starting = false;
    }
  }

  void attach();
  const watchdog = setInterval(() => {
    if (active && Date.now() - lastRaw > SILENCE_MS) {
      lastRaw = Date.now();
      // The native service never delivered a fix: use the phone's web/expo GPS instead.
      if (usingNative && !gotFix) forceWeb = true;
      void attach();
    }
  }, 4000);
  const onVis = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      if (Date.now() - lastRaw > 3000) void attach();
    }
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);

  return () => {
    active = false;
    clearInterval(watchdog);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
    stopSource?.();
    stopSource = null;
  };
}
