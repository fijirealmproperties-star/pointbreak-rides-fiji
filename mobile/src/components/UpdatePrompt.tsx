import { useCallback, useEffect, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { colors, typography } from "../theme";

function currentBuild(): string | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector('meta[name="pb-build"]');
  const v = el?.getAttribute("content");
  return v && v !== "__PB_BUILD__" ? v : null;
}

export default function UpdatePrompt() {
  const [available, setAvailable] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    const mine = currentBuild();
    if (!mine) return;
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data.build === "string" && data.build !== mine) setAvailable(data.build);
    } catch {}
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    const timer = setInterval(check, 20000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      clearInterval(timer);
    };
  }, [check]);

  async function update() {
    setBusy(true);
    try {
      const regs = await navigator.serviceWorker?.getRegistrations();
      await Promise.all((regs || []).map((r) => r.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
    window.location.reload();
  }

  if (Platform.OS !== "web") return null;

  return (
    <Modal visible={!!available && dismissed !== available} transparent animationType="fade" onRequestClose={() => setDismissed(available)}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <Text style={styles.title}>Update available</Text>
          <Text style={styles.msg}>A new version of Pointbreak is ready. Update now to get the latest features and fixes.</Text>
          <TouchableOpacity style={styles.primary} onPress={update} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? "Updating…" : "Update"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.later} onPress={() => setDismissed(available)} disabled={busy}>
            <Text style={styles.laterText}>Later</Text>
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
  primary: { backgroundColor: colors.sunset, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 18 },
  primaryText: { color: "#14100c", fontWeight: "800", fontSize: typography.body },
  later: { paddingVertical: 12, alignItems: "center", marginTop: 6 },
  laterText: { color: colors.textMuted, fontWeight: "700", fontSize: typography.body },
});
