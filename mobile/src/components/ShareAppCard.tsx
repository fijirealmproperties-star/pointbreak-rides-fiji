import { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Share, Platform } from "react-native";
import qrcode from "qrcode-generator";
import { colors, typography } from "../theme";

export const APP_DOWNLOAD_URL = "https://pointbreakridesfj.site.je/download/";
const MESSAGE = "Get Pointbreak Fiji Rides - book a ride or drive in Fiji:";
const QR_SIZE = 200;

function QrCode({ value }: { value: string }) {
  const rows = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
  }, [value]);
  const cell = QR_SIZE / rows.length;
  return (
    <View style={styles.qrBox}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", height: cell }}>
          {row.map((dark, c) => (
            <View key={c} style={{ width: cell, height: cell, backgroundColor: dark ? "#0A1628" : "#FFFFFF" }} />
          ))}
        </View>
      ))}
    </View>
  );
}

export default function ShareAppCard() {
  const [note, setNote] = useState("");

  async function copy() {
    try {
      const nav: any = typeof navigator !== "undefined" ? navigator : null;
      if (nav?.clipboard) {
        await nav.clipboard.writeText(APP_DOWNLOAD_URL);
        setNote("Link copied");
        return;
      }
    } catch {}
    setNote(APP_DOWNLOAD_URL);
  }

  async function share() {
    try {
      const nav: any = typeof navigator !== "undefined" ? navigator : null;
      if (Platform.OS === "web" && nav?.share) {
        await nav.share({ title: "Pointbreak Fiji Rides", text: MESSAGE, url: APP_DOWNLOAD_URL });
        return;
      }
      if (Platform.OS !== "web") {
        await Share.share({ message: `${MESSAGE} ${APP_DOWNLOAD_URL}` });
        return;
      }
    } catch {
      return;
    }
    await copy();
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Share Pointbreak</Text>
      <Text style={styles.sub}>Scan this code with a phone camera to download the app.</Text>
      <View style={styles.qrWrap}>
        <QrCode value={APP_DOWNLOAD_URL} />
      </View>
      <Text style={styles.link} selectable>{APP_DOWNLOAD_URL}</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={share}>
          <Text style={styles.btnText}>Share link</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnAlt]} onPress={copy}>
          <Text style={[styles.btnText, { color: colors.text }]}>Copy link</Text>
        </TouchableOpacity>
      </View>
      {note ? <Text style={styles.note} selectable>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginTop: 14,
    alignItems: "center",
  },
  title: { color: colors.text, fontSize: typography.body, fontWeight: "700", alignSelf: "flex-start" },
  sub: { color: colors.textMuted, fontSize: typography.small, alignSelf: "flex-start", marginTop: 4 },
  qrWrap: { backgroundColor: "#FFFFFF", padding: 14, borderRadius: 14, marginTop: 14 },
  qrBox: { width: QR_SIZE, height: QR_SIZE },
  link: { color: colors.textMuted, fontSize: typography.tiny, marginTop: 10, textAlign: "center" },
  row: { flexDirection: "row", gap: 10, marginTop: 14, width: "100%" },
  btn: { flex: 1, backgroundColor: colors.sunset, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  btnAlt: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  btnText: { color: "#14100c", fontWeight: "700", fontSize: typography.small },
  note: { color: colors.textMuted, fontSize: typography.tiny, marginTop: 8, textAlign: "center" },
});
