import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import * as Location from "expo-location";
import { colors, typography } from "../theme";
import { useUpdateAvailable } from "../updateState";
import { checkLocation, LocationState, shouldWarnLocation } from "../locationCheck";

function check() {
  const geo = typeof navigator !== "undefined" ? navigator.geolocation : null;
  return checkLocation(Platform.OS, geo, Location);
}

export default function LocationGate() {
  const [state, setState] = useState<LocationState | "checking">("checking");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const checkingRef = useRef(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const [hiddenUntil, setHiddenUntil] = useState(0);
  const [, setTick] = useState(0);
  const updateAvailable = useUpdateAvailable();

  const recheck = useCallback(async () => {
    if (busyRef.current || checkingRef.current) return;
    checkingRef.current = true;
    const generation = generationRef.current;
    const result = await check();
    checkingRef.current = false;
    if (mountedRef.current && generation === generationRef.current) {
      setState(result);
      if (result === "ok") setHiddenUntil(0);
      setTick((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    recheck();
    const t = setInterval(recheck, 5000);
    const onVis = () => { if (document.visibilityState === "visible") recheck(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    if (typeof window !== "undefined") window.addEventListener("focus", recheck);
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") recheck();
    });
    return () => {
      mountedRef.current = false;
      generationRef.current++;
      clearInterval(t);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
      if (typeof window !== "undefined") window.removeEventListener("focus", recheck);
      appState.remove();
    };
  }, [recheck]);

  async function turnOn() {
    busyRef.current = true;
    setBusy(true);
    generationRef.current++;
    try {
      if (Platform.OS !== "web") {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted" && !permission.canAskAgain) {
          await Linking.openSettings();
        } else if (permission.status === "granted" && Platform.OS === "android") {
          await Location.enableNetworkProviderAsync();
        }
      }
    } catch (error) {
      console.warn("Could not open location settings:", error);
    }
    const after = await check();
    busyRef.current = false;
    if (mountedRef.current) {
      setBusy(false);
      setState(after);
      if (after === "ok") setHiddenUntil(0);
    }
  }

  // A pending update is shown first, in front of this prompt.
  if (!shouldWarnLocation(state) || updateAvailable || Date.now() < hiddenUntil) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setHiddenUntil(Date.now() + 5 * 60 * 1000)}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <Text style={styles.title}>Turn on your location</Text>
          <Text style={styles.msg}>Pointbreak needs your location to work. Turn on your phone's location and allow location access for this app or website.</Text>
          <TouchableOpacity style={styles.primary} onPress={turnOn} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? "Checking…" : "Check location again"}</Text>
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
