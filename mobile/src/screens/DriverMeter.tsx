import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme";
import { getUser } from "../api";
import RoadsideMeter from "../components/RoadsideMeter";
import SurfsUpMeter from "../components/SurfsUpMeter";

export default function DriverMeter() {
  const insets = useSafeAreaInsets();
  const [driverId, setDriverId] = useState<string | undefined>();
  const [mode, setMode] = useState<"classic" | "surf">("classic");

  useEffect(() => {
    getUser().then((u) => setDriverId(u?.driverProfile?.id || u?.id));
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={styles.tabs}>
          {([["classic", "Roadside Meter"], ["surf", "Surfs Up Meter"]] as const).map(([k, label]) => (
            <TouchableOpacity key={k} style={[styles.tab, mode === k && styles.tabOn]} onPress={() => setMode(k)}>
              <Text style={[styles.tabText, mode === k && styles.tabTextOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {/* Both stay mounted so a running trip is never lost when switching tabs. */}
        <View style={mode === "classic" ? undefined : { display: "none" }}><RoadsideMeter driverId={driverId} /></View>
        <View style={mode === "surf" ? undefined : { display: "none" }}><SurfsUpMeter driverId={driverId} /></View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.deep },
  tabs: { flexDirection: "row", marginBottom: 12, backgroundColor: "#222", borderRadius: 10, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  tabOn: { backgroundColor: "#ffcc00" },
  tabText: { color: "#aaa", fontWeight: "bold" },
  tabTextOn: { color: "#000" },
});
