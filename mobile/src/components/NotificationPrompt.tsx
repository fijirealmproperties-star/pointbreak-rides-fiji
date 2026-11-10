import { useCallback, useEffect, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { api, getUser } from "../api";
import { enablePush, pushSupported } from "../push";
import { isNativeApp, registerNativePush } from "../nativePush";
import { nativePlugin } from "../nativeBridge";
import { colors, typography } from "../theme";

const isWeb = Platform.OS === "web" && typeof window !== "undefined";
const SEEN_KEY = "pb-notice-seen";
const ASKED_KEY = "pb-notif-asked";

export function nativeNotifs() {
  return nativePlugin("LocalNotifications");
}

export async function permissionState(): Promise<"granted" | "denied" | "ask" | "unsupported"> {
  const n = nativeNotifs();
  if (n) {
    try {
      const p = await n.checkPermissions();
      return p.display === "granted" ? "granted" : p.display === "denied" ? "denied" : "ask";
    } catch {
      return "unsupported";
    }
    if (isNativeApp()) return "unsupported";
  }
  if (isWeb && "Notification" in window) {
    return Notification.permission === "granted" ? "granted" : Notification.permission === "denied" ? "denied" : "ask";
  }
  return "unsupported";
}

async function showLocal(title: string, body: string, id: number) {
  const n = nativeNotifs();
  if (n) {
    await n.schedule({ notifications: [{ id, title, body, smallIcon: "ic_stat_icon_config_sample" }] });
    return;
  }
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) await reg.showNotification(title, { body, icon: "/icons/icon-192.png", tag: `notice-${id}` });
}

export default function NotificationPrompt() {
  const [state, setState] = useState<"granted" | "denied" | "ask" | "unsupported">("unsupported");
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    const u = await getUser().catch(() => null);
    if (!u) { setShow(false); return; }
    const s = await permissionState();
    setState(s);
    if (s === "ask") setShow(true);
    else if (s === "granted") {
      setShow(false);
      if (isNativeApp()) {
        const result = await registerNativePush(false);
        if (!result.ok) console.warn("App notifications are not connected:", result.reason);
      }
      else if (pushSupported()) enablePush().catch(() => {});
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  // While the app is open, show new admin notices in the phone's notification panel.
  useEffect(() => {
    if (state !== "granted") return;
    let stop = false;
    const poll = async () => {
      try {
        const r = await api<{ notices: { id: string; title: string; body: string }[] }>("/notices");
        const seen = new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) || "null") || []);
        const first = !localStorage.getItem(SEEN_KEY);
        const fresh = r.notices.filter((n) => !seen.has(n.id));
        if (!first && !stop) {
          for (const n of fresh.slice(0, 3)) await showLocal(n.title, n.body, Math.floor(Math.random() * 2e9));
        }
        localStorage.setItem(SEEN_KEY, JSON.stringify(r.notices.map((n) => n.id).slice(0, 100)));
      } catch {}
    };
    poll();
    const t = setInterval(poll, 20000);
    return () => { stop = true; clearInterval(t); };
  }, [state]);

  async function allow() {
    setMsg("");
    const r = await enablePush();
    if (r.ok) { setShow(false); refresh(); }
    else setMsg(r.reason || "Could not turn on notifications.");
  }

  function later() {
    try { localStorage.setItem(ASKED_KEY, String(Date.now())); } catch {}
    setShow(false);
  }

  if (!isWeb || !show) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={later}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <Text style={styles.title}>🔔 Turn on notifications</Text>
          <Text style={styles.msg}>
            Tap Allow, then choose "Allow" on the next phone prompt. You will then get ride alerts and Pointbreak messages in your phone's notification panel.
          </Text>
          {msg ? <Text style={styles.err}>{msg}</Text> : null}
          <TouchableOpacity style={styles.primary} onPress={allow}>
            <Text style={styles.primaryText}>Allow</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.later} onPress={later}>
            <Text style={styles.laterText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 },
  box: { width: "100%", maxWidth: 360, backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 22 },
  title: { color: colors.text, fontSize: 18, fontWeight: "800" },
  msg: { color: colors.textMuted, fontSize: typography.body, lineHeight: 20, marginTop: 8 },
  err: { color: "#ff8a80", fontSize: typography.small, marginTop: 10 },
  primary: { backgroundColor: colors.sunset, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 18 },
  primaryText: { color: "#14100c", fontWeight: "800", fontSize: typography.body },
  later: { paddingVertical: 12, alignItems: "center", marginTop: 6 },
  laterText: { color: colors.textMuted, fontWeight: "700", fontSize: typography.body },
});
