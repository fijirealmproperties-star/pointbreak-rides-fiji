import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { enablePush } from "../push";
import { isNativeApp, registerNativePush } from "../nativePush";
import { api } from "../api";
import { permissionState } from "./NotificationPrompt";
import { colors, typography } from "../theme";

export default function NotificationButton() {
  const [state, setState] = useState<"granted" | "denied" | "ask" | "unsupported">("ask");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => setState(await permissionState()), []);
  useEffect(() => {
    refresh();
    if (typeof window === "undefined") return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  async function turnOn() {
    setBusy(true);
    setMsg("");
    try {
      const r = await enablePush();
      setMsg(r.ok ? "Notifications are connected to this device." : r.reason || "Could not turn on notifications. Check your phone settings.");
    } catch (error) {
      console.warn("Could not enable notifications:", error);
      setMsg(error instanceof Error ? error.message : "Could not enable notifications. Please try again.");
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function testAppNotification() {
    setBusy(true);
    setMsg("");
    try {
      const result = await registerNativePush();
      if (!result.ok || !result.token) {
        setMsg(result.reason || "Could not connect app notifications.");
        return;
      }
      setMsg("Go to your phone's home screen now. The test will be sent in 5 seconds.");
      await api("/push/test-native", { method: "POST", body: { token: result.token } });
      setMsg("App test notification sent. Tap it to open Pointbreak.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not send the app test notification.");
    } finally {
      setBusy(false);
    }
  }

  const on = state === "granted";
  return (
    <View style={styles.card}>
      <Text style={styles.title}>🔔 Notifications</Text>
      <Text style={styles.sub}>
        {on ? (isNativeApp() ? "Permission is allowed. Tap below to connect app notifications." : "Notification permission is allowed.") : state === "denied" ? (isNativeApp() ? "Notifications are blocked. Allow them in your phone settings for Pointbreak." : "Notifications are blocked. Allow them in your browser's site settings for Pointbreak.") : "Turn on to get ride alerts and messages in your phone's notification panel, even when the app is closed."}
      </Text>
      <TouchableOpacity style={[styles.btn, on && styles.btnOn]} onPress={turnOn} disabled={busy}>
        <Text style={styles.btnText}>{busy ? "Please wait..." : on ? "Connect notifications again" : "Turn on notifications"}</Text>
      </TouchableOpacity>
      {isNativeApp() ? (
        <TouchableOpacity style={[styles.btn, styles.testBtn]} onPress={testAppNotification} disabled={busy}>
          <Text style={styles.btnText}>Send app test notification</Text>
        </TouchableOpacity>
      ) : null}
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
  testBtn: { marginTop: 8, backgroundColor: "#34485E" },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  msg: { color: colors.text, fontSize: 12, marginTop: 10 },
});
