import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { enablePush } from "../push";
import { nativePushAvailable, registerNativePush } from "../nativePush";
import { nativeNotifs, permissionState } from "./NotificationPrompt";
import { colors, typography } from "../theme";

export default function NotificationButton() {
  const [state, setState] = useState<"granted" | "denied" | "ask" | "unsupported">("ask");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => setState(await permissionState()), []);
  useEffect(() => { refresh(); }, [refresh]);

  async function turnOn() {
    setBusy(true);
    setMsg("");
    try {
      const n = nativeNotifs();
      if (n) {
        const p = await n.requestPermissions().catch(() => null);
        if (p?.display === "granted") {
          await registerNativePush();
          setMsg("Notifications are on.");
        } else {
          setMsg("Blocked. Open phone Settings > Apps > Pointbreak > Notifications and turn them on.");
        }
      } else {
        const r = await enablePush();
        setMsg(r.ok ? "Notifications are on." : r.reason || "Could not turn on notifications. Check your browser or phone settings.");
      }
      if (state === "granted" && nativePushAvailable()) await registerNativePush();
    } finally {
      setBusy(false);
      refresh();
    }
  }

  const on = state === "granted";
  return (
    <View style={styles.card}>
      <Text style={styles.title}>🔔 Notifications</Text>
      <Text style={styles.sub}>
        {on ? "On. You will get ride alerts and messages on this phone." : "Turn on to get ride alerts and messages in your phone's notification panel, even when the app is closed."}
      </Text>
      <TouchableOpacity style={[styles.btn, on && styles.btnOn]} onPress={turnOn} disabled={busy}>
        <Text style={styles.btnText}>{busy ? "Please wait..." : on ? "✓ Notifications on (tap to re-link)" : "Turn on notifications"}</Text>
      </TouchableOpacity>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card ?? "#0F2238", borderRadius: 16, padding: 16, marginBottom: 14 },
  title: { color: colors.text, fontSize: typography.body, fontWeight: "800", marginBottom: 6 },
  sub: { color: colors.textMuted ?? "#9FB3C8", fontSize: 13, marginBottom: 12 },
  btn: { backgroundColor: colors.ocean, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  btnOn: { backgroundColor: "#1E9E6A" },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  msg: { color: colors.text, fontSize: 12, marginTop: 10 },
});
