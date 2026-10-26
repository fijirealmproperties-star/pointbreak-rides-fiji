import React, { useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Modal } from "react-native";
import { Place } from "../api";

type Props = {
  places: Place[];
  onSelect: (place: Place) => void;
  label: string;
  open: boolean;
  onClose: () => void;
};

function typeIcon(type: string): string {
  switch (type) {
    case "airport": return "✈";
    case "beach": return "🏖";
    case "landmark": return "🏛";
    case "city": return "📍";
    case "town": return "📍";
    case "resort": return "🏖";
    default: return "📍";
  }
}

export default function PlacePicker({ places, onSelect, label, open, onClose }: Props) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return places;
    return places.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.short_name.toLowerCase().includes(needle) ||
        p.region.toLowerCase().includes(needle)
    );
  }, [places, q]);

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>{label}</Text>
            <TouchableOpacity
              onPress={() => {
                onClose();
                setQ("");
              }}
              hitSlop={12}
            >
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.searchWrap}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.search}
              value={q}
              onChangeText={setQ}
              placeholder={`Search ${label.toLowerCase()}…`}
              placeholderTextColor="#999"
              autoFocus
              autoCorrect={false}
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 24 }}
            ListEmptyComponent={
              <View style={{ padding: 32, alignItems: "center" }}>
                <Text style={{ color: "#999" }}>No places match "{q}"</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  onSelect(item);
                  onClose();
                  setQ("");
                }}
              >
                <View style={styles.rowIconWrap}>
                  <Text style={styles.rowIcon}>{typeIcon(item.type)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{item.name}</Text>
                  <Text style={styles.rowSub}>
                    {item.short_name} · {item.region}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: "80%",
    paddingTop: 8,
    paddingHorizontal: 20,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#DDD",
    alignSelf: "center",
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#000",
  },
  close: {
    fontSize: 18,
    fontWeight: "700",
    color: "#666",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F3F3",
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  search: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: "#000",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#EEE",
  },
  rowIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F3F3F3",
    alignItems: "center",
    justifyContent: "center",
  },
  rowIcon: {
    fontSize: 18,
  },
  rowName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#000",
  },
  rowSub: {
    fontSize: 12,
    color: "#888",
    marginTop: 1,
  },
});
