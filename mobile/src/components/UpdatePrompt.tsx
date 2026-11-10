import { useEffect, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { colors, typography } from "../theme";
import { applyUpdate, useUpdateAvailable } from "../updateState";

const APK_URL = "https://github.com/fijirealmproperties-star/pointbreak-rides-fiji/releases/download/apk-latest/pointbreak.apk";

// An installed APK that predates the native GPS plugin needs one reinstall.
function needsNewApk(): boolean {
  try {
    const t = Number(localStorage.getItem("pb-apk-prompt") || 0);
    if (t && Date.now() - t < 7 * 24 * 3600 * 1000) return false;
  } catch {}
  const cap = (globalThis as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return false;
  try { return !cap.isPluginAvailable("BackgroundGeolocation"); } catch { return false; }
}

export default function UpdatePrompt() {
  const [apkOld] = useState(needsNewApk);
  const [apkLater, setApkLater] = useState(false);
  const available = useUpdateAvailable();
  const [snoozeUntil, setSnoozeUntil] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [, tick] = useState(0);

  // "Later" only snoozes: the reminder returns until the app is updated.
  useEffect(() => {
    if (!available) return;
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, [available]);

  async function update() {
    setBusy(true);
    setError("");
    try {
      await applyUpdate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply the update. Please try again.");
      setBusy(false);
    }
  }
  if (Platform.OS !== "web") return null;

  if (apkOld && !apkLater) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setApkLater(true)}>
        <View style={styles.backdrop}>
          <View style={styles.box}>
            <Text style={styles.title}>New app version</Text>
            <Text style={styles.msg}>A new Pointbreak app with accurate background GPS is ready. Tap Download, open the file when it finishes, and choose Install.</Text>
            <TouchableOpacity style={styles.primary} onPress={() => { try { localStorage.setItem("pb-apk-prompt", String(Date.now())); } catch {} setApkLater(true); window.location.href = APK_URL; }}>
              <Text style={styles.primaryText}>Download</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.later} onPress={() => { try { localStorage.setItem("pb-apk-prompt", String(Date.now())); } catch {} setApkLater(true); }}>
              <Text style={styles.laterText}>Later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={!!available && Date.now() >= snoozeUntil} transparent animationType="fade" onRequestClose={() => setSnoozeUntil(Date.now() + 5 * 60 * 1000)}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <Text style={styles.title}>Update available</Text>
          <Text style={styles.msg}>A new version of Pointbreak is ready. Update now to get the latest features and fixes.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity style={styles.primary} onPress={update} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? "Updating…" : "Update"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.later} onPress={() => setSnoozeUntil(Date.now() + 5 * 60 * 1000)} disabled={busy}>
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
  error: { color: colors.coral, fontSize: typography.body, marginTop: 8 },
  primary: { backgroundColor: colors.sunset, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 18 },
  primaryText: { color: "#14100c", fontWeight: "800", fontSize: typography.body },
  later: { paddingVertical: 12, alignItems: "center", marginTop: 6 },
  laterText: { color: colors.textMuted, fontWeight: "700", fontSize: typography.body },
});
