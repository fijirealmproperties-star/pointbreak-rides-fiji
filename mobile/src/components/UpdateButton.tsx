import { useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity } from "react-native";
import { colors, typography } from "../theme";

// Manual update: clears cached copies of the app and reloads the newest version.
export default function UpdateButton() {
  const [busy, setBusy] = useState(false);
  if (Platform.OS !== "web") return null;

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

  return (
    <TouchableOpacity style={styles.btn} onPress={update} disabled={busy}>
      <Text style={styles.text}>{busy ? "Updating..." : "Update app"}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { backgroundColor: colors.sunset, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 12 },
  text: { color: "#14100c", fontWeight: "800", fontSize: typography.body },
});
