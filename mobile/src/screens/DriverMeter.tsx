import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme";
import { getUser } from "../api";
import RoadsideMeter from "../components/RoadsideMeter";

export default function DriverMeter() {
  const insets = useSafeAreaInsets();
  const [driverId, setDriverId] = useState<string | undefined>();

  useEffect(() => {
    getUser().then((u) => setDriverId(u?.driverProfile?.id || u?.id));
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <RoadsideMeter driverId={driverId} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.deep },
});
