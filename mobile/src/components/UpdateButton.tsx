import { useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, typography } from "../theme";
import { applyUpdate, useUpdateAvailable } from "../updateState";

// Shown on Profile only while a newer version is waiting, for anyone who missed the popup.
export default function UpdateButton() {
  const available = useUpdateAvailable();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (Platform.OS !== "web" || !available) return null;

  return (
    <View>
      <TouchableOpacity style={styles.btn} onPress={async () => {
        setBusy(true);
        setError("");
        try {
          await applyUpdate();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not apply the update. Please try again.");
          setBusy(false);
        }
      }} disabled={busy}>
        <Text style={styles.text}>{busy ? "Updating..." : "Update app"}</Text>
      </TouchableOpacity>
      <Text style={styles.note}>A new version is available. Tap to update and restart.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { backgroundColor: colors.sunset, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 12 },
  text: { color: "#14100c", fontWeight: "800", fontSize: typography.body },
  note: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 6 },
  error: { color: colors.coral, fontSize: typography.body, textAlign: "center", marginTop: 6 },
});