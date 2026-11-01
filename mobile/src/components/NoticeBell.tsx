import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, typography } from "../theme";
import { api } from "../api";
import { enablePush, pushSupported } from "../push";

type Notice = { id: string; title: string; body: string; created_at: string; read: boolean };

function when(s: string) {
  const d = new Date(s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function NoticeBell() {
  const insets = useSafeAreaInsets();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [pushMsg, setPushMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ notices: Notice[]; unread: number }>("/notices");
      setNotices(r.notices);
      setUnread(r.unread);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
  }, [load]);

  async function openPanel() {
    setOpen(true);
    await load();
    api("/notices/read", { method: "POST", body: {} })
      .then(() => setUnread(0))
      .catch(() => {});
  }

  async function turnOnAlerts() {
    const r = await enablePush();
    setPushMsg(r.ok ? "Phone alerts are on ✅" : r.reason || "Could not turn on alerts.");
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.bell, { top: insets.top + 8 }]}
        onPress={openPanel}
        accessibilityLabel="Notifications"
      >
        <Text style={styles.bellIcon}>🔔</Text>
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
          </View>
        ) : null}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>🔔 Notifications</Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            </View>
            {pushSupported() ? (
              <TouchableOpacity style={styles.enableBtn} onPress={turnOnAlerts}>
                <Text style={styles.enableText}>Turn on phone alerts</Text>
              </TouchableOpacity>
            ) : null}
            {pushMsg ? <Text style={styles.pushMsg}>{pushMsg}</Text> : null}
            <ScrollView style={{ maxHeight: 420 }}>
              {notices.length === 0 ? (
                <Text style={styles.empty}>No notices yet.</Text>
              ) : (
                notices.map((n) => (
                  <View key={n.id} style={styles.item}>
                    <Text style={styles.itemTitle}>{n.title}</Text>
                    <Text style={styles.itemBody}>{n.body}</Text>
                    <Text style={styles.itemTime}>{when(n.created_at)}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bell: {
    position: "absolute",
    right: 14,
    zIndex: 50,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  bellIcon: { fontSize: 20 },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.coral,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.deep,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sheetTitle: { color: colors.text, fontSize: typography.heading, fontWeight: "800" },
  close: { color: colors.textMuted, fontSize: 22, padding: 4 },
  enableBtn: {
    backgroundColor: colors.ocean,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    marginBottom: 10,
  },
  enableText: { color: "#fff", fontWeight: "800" },
  pushMsg: { color: colors.textMuted, fontSize: typography.small, marginBottom: 10 },
  empty: { color: colors.textMuted, textAlign: "center", paddingVertical: 24 },
  item: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  itemTitle: { color: colors.text, fontWeight: "800", fontSize: typography.body },
  itemBody: { color: colors.text, fontSize: typography.small, marginTop: 4 },
  itemTime: { color: colors.textMuted, fontSize: typography.tiny, marginTop: 6 },
});
