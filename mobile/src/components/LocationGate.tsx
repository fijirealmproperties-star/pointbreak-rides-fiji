import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import * as Location from "expo-location";
import { colors, typography } from "../theme";
import { useUpdateAvailable } from "../updateState";

type State = "ok" | "denied" | "off";

// Web probe: a recent cached fix is enough; an error tells us why location is unusable.
function probeWeb(): Promise<State> {
  return new Promise((resolve) => {
    const geo: any = typeof navigator !== "undefined" ? navigator.geolocation : null;
    if (!geo) return resolve("ok");
    geo.getCurrentPosition(
      () => resolve("ok"),
      (e: any) => resolve(e?.code === 1 ? "denied" : e?.code === 2 ? "off" : "ok"),
      { maximumAge: 120000, timeout: 10000, enableHighAccuracy: false }
    );
  });
}

async function check(): Promise<State> {
  try {
    if (Platform.OS !== "web") {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status === "denied") return "denied";
      if (perm.status === "granted" && !(await Location.hasServicesEnabledAsync())) return "off";
      return "ok";
    }
    return await probeWeb();
  } catch {
    return "ok";
  }
}

// Blocks the app until location is allowed and switched on, and asks again whenever it is turned off.
export default function LocationGate() {
  const [state, setState] = useState<State>("ok");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [hiddenUntil, setHiddenUntil] = useState(0);
  const [, setTick] = useState(0);
  const updateAvailable = useUpdateAvailable();

  const recheck = useCallback(async () => {
    if (busyRef.current) return;
    setState(await check());
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    recheck();
    const t = setInterval(recheck, 5000);
    const onVis = () => { if (document.visibilityState === "visible") recheck(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    if (typeof window !== "undefined") window.addEventListener("focus", recheck);
    return () => {
      clearInterval(t);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
      if (typeof window !== "undefined") window.removeEventListener("focus", recheck);
    };
  }, [recheck]);

  // Android only: opens the phone's location or app settings page.
  function openSettings(off: boolean) {
    try {
      const action = off ? "android.settings.LOCATION_SOURCE_SETTINGS" : "android.settings.APPLICATION_DETAILS_SETTINGS";
      const url = off
        ? `intent:#Intent;action=${action};end`
        : `intent:#Intent;action=${action};data=package:fj.pointbreak.rides;end`;
      window.location.href = url;
    } catch {}
  }

  async function turnOn() {
    busyRef.current = true;
    setBusy(true);
    try {
      await Location.requestForegroundPermissionsAsync();
      if (Platform.OS !== "web") {
        try { await Location.enableNetworkProviderAsync(); } catch {}
      }
    } catch {}
    // Only when location still cannot be detected do we send the user to settings.
    const after = await check();
    busyRef.current = false;
    setBusy(false);
    setState(after);
    if (after !== "ok") openSettings(after === "off");
  }

  // A pending update is shown first, in front of this prompt.
  if (state === "ok" || updateAvailable || Date.now() < hiddenUntil) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setHiddenUntil(Date.now() + 5 * 60 * 1000)}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <Text style={styles.title}>Turn on your location</Text>
          <Text style={styles.msg}>Pointbreak cannot detect your location. Tap the button to open your phone settings, turn Location on, then come back.</Text>
          <TouchableOpacity style={styles.primary} onPress={turnOn} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? "Checking…" : "Turn on location"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ paddingVertical: 12, alignItems: "center", marginTop: 6 }} onPress={() => setHiddenUntil(Date.now() + 5 * 60 * 1000)}>
            <Text style={{ color: colors.textMuted, fontWeight: "700", fontSize: typography.body }}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 24 },
  box: { width: "100%", maxWidth: 360, backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 22 },
  title: { color: colors.text, fontSize: 18, fontWeight: "800" },
  msg: { color: colors.textMuted, fontSize: typography.body, lineHeight: 20, marginTop: 8 },
  primary: { backgroundColor: colors.sunset, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 18 },
  primaryText: { color: "#14100c", fontWeight: "800", fontSize: typography.body },
});
