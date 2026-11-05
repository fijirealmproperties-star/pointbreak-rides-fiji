import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import * as Location from "expo-location";
import { colors, typography } from "../theme";

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
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status === "denied") return "denied";
    if (perm.status === "granted") {
      if (Platform.OS !== "web") {
        const on = await Location.hasServicesEnabledAsync();
        return on ? "ok" : "off";
      }
      return await probeWeb();
    }
    return "denied";
  } catch {
    return "ok";
  }
}

// Blocks the app until location is allowed and switched on, and asks again whenever it is turned off.
export default function LocationGate() {
  const [state, setState] = useState<State>("ok");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const recheck = useCallback(async () => {
    if (busyRef.current) return;
    setState(await check());
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

  async function turnOn() {
    busyRef.current = true;
    setBusy(true);
    try {
      await Location.requestForegroundPermissionsAsync();
      if (Platform.OS !== "web") {
        try { await Location.enableNetworkProviderAsync(); } catch {}
      }
    } catch {}
    busyRef.current = false;
    setBusy(false);
    recheck();
  }

  if (state === "ok") return null;
  const off = state === "off";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <Text style={styles.title}>{off ? "Turn on your location" : "Allow location access"}</Text>
          <Text style={styles.msg}>
            {off
              ? "Your phone's location is switched off. Pointbreak needs it to find rides, drivers and measure trips. Turn on Location in your phone's quick settings, then come back."
              : "Pointbreak needs your location to find rides and drivers and to measure trips. Tap the button and choose Allow. If nothing appears, open your browser or phone settings, allow Location for Pointbreak, and return."}
          </Text>
          <TouchableOpacity style={styles.primary} onPress={turnOn} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? "Checking…" : off ? "I turned it on" : "Turn on location"}</Text>
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
